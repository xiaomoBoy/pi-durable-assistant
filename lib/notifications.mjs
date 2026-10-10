// F3：通用 Webhook / 飞书的持久通知队列。
// 外部 HTTP 永远在 Durable 事务外执行；状态变更只在事务中完成。
import { defineDoc } from "@earendil-works/pi-durable";

export const NotificationOutbox = defineDoc({
  kind: "app.foundation.notification-outbox", version: 1, scope: "session",
  initial: () => ({ items: [] }),
});

const KINDS = new Set(["generic", "feishu"]);
const MODES = new Set(["off", "errors", "all"]);
const MAX_QUEUE = 1500;
const MAX_TEXT = 5000;
const HISTORY_KEEP = 300;
const HISTORY_AGE_MS = 7 * 86400_000;
const DEFAULT_INTERVAL = 1500;
const MAX_ATTEMPTS = 8;

export function notificationSettings(env = process.env) {
  const mode = env.NOTIFY_MODE || "errors";
  const kind = env.NOTIFY_WEBHOOK_KIND || "generic";
  if (!MODES.has(mode)) throw Error("NOTIFY_MODE 只能是 errors/all/off");
  if (!KINDS.has(kind)) throw Error("NOTIFY_WEBHOOK_KIND 只能是 generic/feishu");
  const url = String(env.NOTIFY_WEBHOOK_URL || "").trim();
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw Error("NOTIFY_WEBHOOK_URL 格式不正确"); }
    // 仅操作员显式配置的目标；避免明文传输通知正文或 URL 凭据。
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (env.NODE_ENV === "test" || env.NOTIFY_ALLOW_HTTP === "1")))
      throw Error("NOTIFY_WEBHOOK_URL 必须为 HTTPS，明确允许 HTTP 时设置 NOTIFY_ALLOW_HTTP=1");
    if (parsed.username || parsed.password) throw Error("通知 URL 不允许携带账号密码");
  }
  return { mode, kind, url, enabled: !!url && mode !== "off" };
}

export function shouldQueue(event, settings) {
  if (!settings.enabled) return false;
  return settings.mode === "all" || (settings.mode === "errors" && event.failed === true);
}

export function retryDelayMs(attempt, random = Math.random) {
  const exponential = Math.min(30 * 60_000, 2_000 * 2 ** Math.max(0, Math.min(attempt - 1, 15)));
  return Math.floor(exponential * (0.8 + random() * 0.4));
}

export function pruneOutbox(doc, now = Date.now()) {
  const pending = doc.items.filter(x => x.state !== "sent");
  const recent = doc.items.filter(x => x.state === "sent" && x.updatedAt > now - HISTORY_AGE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, HISTORY_KEEP);
  const keep = new Set([...pending, ...recent].map(x => x.id));
  doc.items = doc.items.filter(x => keep.has(x.id));
}

// 必须从业务完成时的同一个 tx 调用，避免“业务提交成功但事件还没入库”。
export async function queueNotificationInTx(tx, event, settings = notificationSettings(), now = Date.now()) {
  if (!shouldQueue(event, settings)) return false;
  if (typeof event.id !== "string" || !/^[a-zA-Z0-9:_-]{1,160}$/.test(event.id))
    throw Error("通知事件 id 不合法");
  if (!["schedule", "background", "reminder"].includes(event.type)) throw Error("通知事件类型无效");
  if (typeof event.text !== "string" || !event.text.trim())
    throw Error("通知文本无效");
  const doc = await tx.doc(NotificationOutbox);
  // 执行结果可能因为 Durable replay 再次经过这一事务：id 相同不重新入队。
  if (doc.items.some(x => x.id === event.id)) return false;
  pruneOutbox(doc, now);
  if (doc.items.length >= MAX_QUEUE) throw Error("通知积压超限，暂停新任务交付以保护持久队列");
  const timestamp = now;
  doc.items.push({ id: event.id, type: event.type, kind: settings.kind,
    text: event.text.slice(0, MAX_TEXT), failed: event.failed === true, state: "pending",
    attempts: 0, nextAt: timestamp, leaseUntil: 0, createdAt: timestamp, updatedAt: timestamp,
    lastStatus: null, lastError: null });
  return true;
}
const detach = value => JSON.parse(JSON.stringify(value));

export function notificationPayload(item) {
  return item.kind === "feishu"
    ? { msg_type: "text", content: { text: item.text } }
    : { id: item.id, type: item.type, text: item.text, failed: item.failed, at: new Date(item.createdAt).toISOString() };
}

export function safeNotification(item) {
  const { text, ...rest } = item;
  return { ...rest, preview: text?.slice(0, 140) ?? "", bytes: Buffer.byteLength(text || "") };
}

export class NotificationService {
  constructor({ root, harness, context, env = process.env, fetchImpl = fetch, intervalMs = DEFAULT_INTERVAL, clock = Date.now, random = Math.random }) {
    this.root = root; this.harness = harness; this.context = context; this.fetchImpl = fetchImpl;
    this.intervalMs = intervalMs; this.clock = clock; this.random = random;
    this.env = env; this.running = false; this.timer = null;
  }
  config() { return notificationSettings(this.env); }
  async status() {
    const doc = await this.harness.snapshot(NotificationOutbox, this.context);
    const items = doc?.items ?? [];
    const counts = { pending: 0, sending: 0, sent: 0, blocked: 0 };
    for (const item of items) if (Object.hasOwn(counts, item.state)) counts[item.state]++;
    const { kind, mode, enabled } = this.config();
    return { enabled, mode, kind, counts, total: items.length };
  }
  async list({ limit = 100 } = {}) {
    const doc = await this.harness.snapshot(NotificationOutbox, this.context);
    return [...(doc?.items ?? [])].sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(200, limit))).map(safeNotification);
  }
  async retry(id) {
    if (typeof id !== "string" || id.length > 160) throw Error("事件 ID 无效");
    return this.root.commit(async tx => {
      const item = (await tx.doc(NotificationOutbox)).items.find(x => x.id === id);
      if (!item) throw Error("通知事件不存在");
      if (item.state !== "blocked") throw Error("只有阻断状态可手动重试");
      item.state = "pending"; item.attempts = 0; item.nextAt = this.clock();
      item.leaseUntil = 0; item.lastError = null; item.updatedAt = this.clock();
      return safeNotification(detach(item));
    }, this.context);
  }
  async claim() {
    return this.root.commit(async tx => {
      const doc = await tx.doc(NotificationOutbox);
      const now = this.clock();
      const item = doc.items.find(x =>
        (x.state === "pending" && x.nextAt <= now) ||
        (x.state === "sending" && x.leaseUntil < now));
      if (!item) return null;
      item.state = "sending"; item.attempts++;
      item.leaseUntil = now + 30_000; item.updatedAt = now;
      return detach(item);
    }, this.context);
  }
  async settle(claim, response) {
    return this.root.commit(async tx => {
      const item = (await tx.doc(NotificationOutbox)).items.find(x => x.id === claim.id);
      if (!item || item.state !== "sending" || item.attempts !== claim.attempts) return;
      const now = this.clock();
      const status = response?.status ?? null;
      const delivered = !!response?.ok;
      const permanent = status !== null && [400, 401, 403, 404, 405, 410, 413, 415, 422].includes(status);
      const blocked = permanent || item.attempts >= MAX_ATTEMPTS;
      item.state = delivered ? "sent" : blocked ? "blocked" : "pending";
      item.nextAt = delivered || blocked ? 0 : now + retryDelayMs(item.attempts, this.random);
      item.leaseUntil = 0; item.updatedAt = now; item.lastStatus = status;
      item.lastError = delivered ? null : permanent ? "接收方拒绝事件" :
        blocked ? "连续发送失败，已停止自动重试" : "网络失败或服务暂不可用";
      // 已确认投递的不保留完整正文；保留短摘要方便审计。
      if (delivered) item.text = item.text.slice(0, 140);
      return safeNotification(detach(item));
    }, this.context);
  }
  async tick() {
    if (this.running) return;
    const settings = this.config();
    if (!settings.enabled) return; // 关通知或无地址：历史待发送事件保留，不进行外部调用。
    this.running = true;
    try {
      for (let n = 0; n < 5; n++) {
        const claimed = await this.claim();
        if (!claimed) break;
        // 目标类型改变时不能悄悄用新渠道重投旧通知。
        if (claimed.kind !== settings.kind) {
          await this.settle(claimed, { status: 422, ok: false });
          continue;
        }
        let result = null;
        try {
          const response = await this.fetchImpl(settings.url, {
            method: "POST", headers: {
              "content-type": "application/json", "x-pi-event-id": claimed.id,
            },
            body: JSON.stringify(notificationPayload(claimed)),
            redirect: "error", signal: AbortSignal.timeout(8000),
          });
          // 飞书机器人可能返回 HTTP 200，但 JSON code / StatusCode 非 0。
          // 这不能标记为已送达，避免通知被业务错误静默吞掉。
          if (response.ok && claimed.kind === "feishu") {
            let payload = null;
            try { payload = await response.json(); } catch {}
            const code = payload?.code ?? payload?.StatusCode;
            const businessOk = code === 0 || code === "0";
            result = { ok: businessOk, status: businessOk ? response.status : 503 };
          } else {
            result = { ok: response.ok, status: response.status };
          }
        } catch {
          result = { ok: false, status: null };
        }
        const record = await this.settle(claimed, result);
        if (record?.state === "blocked") console.error("通知投递已暂停：", claimed.id, record.lastError);
      }
    } finally { this.running = false; }
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => console.error("通知队列检查失败（已隐藏敏感信息）")), this.intervalMs);
    this.timer.unref?.();
    this.tick().catch(() => console.error("通知队列启动失败（已隐藏敏感信息）"));
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
