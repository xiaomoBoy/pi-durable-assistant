// 微信 Channel：持久会话绑定、入站幂等、回复 outbox。与 iLink 协议实现隔离。
import { createHash } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";

export const WechatState = defineDoc({
  kind: "app.wechat.state", version: 1, scope: "session",
  initial: () => ({ bindings: {}, cursors: {}, outbox: [] }),
});

const now = () => Date.now();
const contentText = (content) => typeof content === "string" ? content :
  (Array.isArray(content) ? content.filter((p) => p?.type === "text").map((p) => p.text || "").join("") : "");

export function inboundKey(binding, wxid) {
  if (typeof binding !== "string" || !/^[a-z0-9_-]{1,32}$/.test(binding)) throw new Error("binding 不合法");
  if (typeof wxid !== "string" || !wxid || wxid.length > 256) throw new Error("from_wxid 不合法");
  return createHash("sha256").update(JSON.stringify([binding, wxid])).digest("hex");
}

export function validateInbound(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("消息体必须为对象");
  if (typeof body.message_id !== "string" || !/^[0-9]{1,32}$/.test(body.message_id))
    throw new Error("message_id 不合法");
  const key = inboundKey(body.binding, body.from_wxid);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voice = typeof body.voice_text === "string" ? body.voice_text.trim() : "";
  if (text.length > 8000 || voice.length > 8000) throw new Error("消息超出长度限制");
  const kinds = Array.isArray(body.media)
    ? body.media.slice(0, 8).map((m) => String(m?.type || "附件")).join("、") : "";
  const message = [text, voice && voice !== text ? voice : "",
    kinds ? "[微信附件：" + kinds + "。当前版本尚不能查看附件内容，请明确告知用户需要文字描述。]" : ""]
    .filter(Boolean).join("\n").slice(0, 8000);
  return { key, binding: body.binding, wxid: body.from_wxid, message, ignored: !message,
    requestId: "wechat:" + createHash("sha256").update(JSON.stringify([body.binding, body.from_wxid, body.message_id])).digest("hex") };
}

export function newAssistantReplies(entries, cursor) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { cursor, replies: [] };
  let offset = 0;
  if (cursor !== undefined && cursor !== null) {
    const found = list.findIndex((e) => String(e.id) === String(cursor));
    // History may be compacted. Missing cursor => skip old entries, never replay historical replies.
    if (found === -1) return { cursor: list.at(-1).id, replies: [] };
    offset = found + 1;
  }
  const replies = list.slice(offset).filter((e) => {
    if (e.kind !== "pi.assistant") return false;
    const message = e.model?.[0];
    if (!message || message.stopReason === "error") return false;
    return !message.content?.some?.((part) => part.type === "toolCall") && !!contentText(message.content).trim();
  }).map((e) => ({ id: e.id, text: contentText(e.model[0].content).trim().slice(0, 20000) }));
  return { cursor: list.at(-1).id, replies };
}

const detach = (value) => JSON.parse(JSON.stringify(value));

export class WechatChannel {
  constructor({ harness, root, agentModel, indexDoc, context, sendURL, sendToken, fetchImpl = fetch, intervalMs = 2000 }) {
    this.harness = harness;
    this.root = root;
    this.agentModel = agentModel;
    this.indexDoc = indexDoc;
    this.context = context;
    this.sendURL = sendURL;
    this.sendToken = sendToken;
    this.fetchImpl = fetchImpl;
    this.intervalMs = intervalMs;
    this.views = new Map();
    this.creating = new Map();
    this.timer = null;
    this.busy = false;
  }

  async start() {
    const doc = await this.harness.snapshot(WechatState, this.context);
    for (const binding of Object.values(doc?.bindings ?? {})) await this.watch(binding);
    this.timer = setInterval(() => this.tick().catch((e) => console.error("微信队列异常：", e?.message)), this.intervalMs);
    this.timer.unref?.();
    await this.tick();
  }

  async incoming(raw) {
    const data = validateInbound(raw);
    // 微信内部可能发送空事件，不让它们阻塞持久消息游标。
    if (data.ignored) return { ok: true, ignored: true };
    const previous = this.creating.get(data.key) || Promise.resolve();
    const job = previous.catch(() => {}).then(() => this.receive(data));
    this.creating.set(data.key, job);
    try { return await job; } finally {
      if (this.creating.get(data.key) === job) this.creating.delete(data.key);
    }
  }

  async receive(data) {
    const doc = await this.harness.snapshot(WechatState, this.context);
    let binding = doc?.bindings?.[data.key];
    let conversation;
    if (!binding) {
      const key = data.key;
      conversation = await this.harness.createConversation({
        ownership: { kind: "ownerless" }, agent: { model: this.agentModel },
        init: async (tx, conversationId) => {
          (await tx.doc(this.indexDoc)).items.push({
            id: conversationId, title: "微信：" + data.binding,
            createdAt: new Date().toISOString(), channel: "wechat",
          });
          (await tx.doc(WechatState)).bindings[key] = {
            key, binding: data.binding, wxid: data.wxid, conversationId,
          };
        },
      }, this.context);
      binding = { key, binding: data.binding, wxid: data.wxid, conversationId: conversation.id };
    } else {
      conversation = await this.harness.conversation(binding.conversationId, this.context);
      if (!conversation) throw new Error("微信绑定的会话不存在");
    }
    await this.watch(binding, conversation);
    const submission = await conversation.submit({
      type: "input", content: data.message, requestId: data.requestId, whenBusy: "followUp",
    }, this.context);
    return { ok: true, conversationId: conversation.id, submissionId: submission.id };
  }

  async watch(binding, conversation) {
    if (this.views.has(binding.conversationId)) return;
    const conv = conversation ?? await this.harness.conversation(binding.conversationId, this.context);
    if (!conv) return;
    const view = await conv.viewState(this.context);
    const listener = { view, off: null, active: true, pending: Promise.resolve() };
    this.views.set(binding.conversationId, listener);
    const scan = () => {
      listener.pending = listener.pending.then(() => this.scan(binding, view.value))
        .catch((e) => console.error("微信回复入队失败：", e?.message));
    };
    listener.off = view.subscribe(scan);
    scan();
  }

  async scan(binding, value) {
    const entries = value?.entries ?? [];
    // Root document transaction atomically advances cursor and enqueues replies.
    await this.root.commit(async (tx) => {
      const state = await tx.doc(WechatState);
      const last = state.cursors[binding.key];
      const { cursor, replies } = newAssistantReplies(entries, last);
      if (cursor === undefined || String(cursor) === String(last)) return;
      for (const reply of replies) {
        const id = binding.key + ":" + reply.id;
        if (!state.outbox.some((x) => x.id === id)) state.outbox.push({
          id, binding: binding.binding, wxid: binding.wxid,
          text: reply.text, status: "pending", attempts: 0,
          nextAt: 0, createdAt: now(),
        });
      }
      state.cursors[binding.key] = cursor;
      // Keep only recent delivery history; never delete unsent jobs.
      const cutoff = now() - 7 * 86400_000;
      state.outbox = state.outbox.filter((x) => x.status !== "sent" || x.createdAt > cutoff);
    }, this.context);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Limit work per tick to prevent monopolizing the node event loop.
      for (let n = 0; n < 8; n++) {
        let item;
        await this.root.commit(async (tx) => {
          const doc = await tx.doc(WechatState);
          item = doc.outbox.find((x) =>
            (x.status === "pending" && x.nextAt <= now()) ||
            (x.status === "sending" && x.nextAt <= now()));
          if (item) {
            item.status = "sending";
            item.nextAt = now() + 60_000; // crash lease
            item.attempts += 1;
            item = detach(item);
          }
        }, this.context);
        if (!item) break;
        let ok = false, permanent = false;
        try {
          const response = await this.fetchImpl(this.sendURL, {
            method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + this.sendToken },
            body: JSON.stringify({ binding: item.binding, to: item.wxid, text: item.text }),
            signal: AbortSignal.timeout(12000), redirect: "error",
          });
          ok = response.ok;
          // No context_token / unauthenticated / invalid destination => wait for manual resolution.
          permanent = [400, 401, 403, 404, 409, 413, 422].includes(response.status);
        } catch (e) {
          console.error("微信发送网络失败：", e?.name || "network error");
        }
        await this.root.commit(async (tx) => {
          const current = (await tx.doc(WechatState)).outbox.find((x) => x.id === item.id);
          if (!current || current.status !== "sending") return;
          current.status = ok ? "sent" : permanent ? "blocked" : "pending";
          current.nextAt = ok ? 0 : now() + Math.min(300_000, 2000 * 2 ** Math.min(current.attempts, 8));
          if (ok) current.sentAt = now();
        }, this.context);
        if (!ok && permanent) console.error("微信消息被拒绝，已暂停自动重试；请检查 wx-bot 状态");
      }
    } finally { this.busy = false; }
  }

  async status() {
    const doc = await this.harness.snapshot(WechatState, this.context);
    return { enabled: true, bindings: Object.values(doc?.bindings ?? {}).map((b) => ({
      binding: b.binding, conversationId: b.conversationId,
    })), pending: doc?.outbox?.filter((x) => x.status === "pending" || x.status === "sending").length ?? 0,
    blocked: doc?.outbox?.filter((x) => x.status === "blocked").length ?? 0 };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const v of this.views.values()) { v.active = false; v.off?.(); v.view.dispose(); }
    this.views.clear();
  }
}
