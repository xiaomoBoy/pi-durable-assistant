// 需要人工批准的文件写入；审批单与执行状态保存在 Durable Document。
import { defineDoc, defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { FileWorkspace, proposeWrite, stripContent } from "./workspace.mjs";

export const PendingActions = defineDoc({
  kind: "app.foundation.approvals", version: 1, scope: "session",
  initial: () => ({ items: [], calls: {} }),
});
const summary = v => ({ content: [{ type: "text", text: v }] });
function pruneActions(doc) {
  const activeStates = new Set(["pending", "approved", "executing"]);
  const active = doc.items.filter(x => activeStates.has(x.state));
  if (active.length >= 100) throw Error("待处理审批过多，请先审核或处理异常");
  const completed = doc.items.filter(x => !activeStates.has(x.state))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
  const retained = new Set([...active, ...completed].map(x => x.id));
  doc.items = doc.items.filter(x => retained.has(x.id));
  for (const [key, value] of Object.entries(doc.calls)) {
    if (!retained.has(value)) delete doc.calls[key];
  }
}
const cleanError = e => /文件|工作区|目录|路径|校验|未启用|越过|超过|无效|授权/.test(e?.message || "")
  ? String(e.message).slice(0, 160) : "操作失败，请检查服务日志";

export function workspaceTools(workspace) {
  return [
    defineTool({
      name: "workspace_list", replay: "safe",
      description: "只读列出个人 Agent 工作区的可用文件。只允许指定的工作区，不能访问私有笔记、服务器或系统目录。",
      parameters: Type.Object({}),
      execute: async () => {
        try { return summary(JSON.stringify(await workspace.list())); }
        catch (e) { return summary("工作区不可用：" + cleanError(e)); }
      },
    }),
    defineTool({
      name: "workspace_read", replay: "safe",
      description: "只读查看个人 Agent 工作区里的 md/txt/json/csv 文件，最大 128KB。",
      parameters: Type.Object({ path: Type.String() }),
      execute: async args => {
        try { return summary(JSON.stringify(await workspace.read(args.path))); }
        catch (e) { return summary("工作区不可用：" + cleanError(e)); }
      },
    }),
    defineTool({
      name: "propose_workspace_write", replay: "safe",
      description: "提议将 Markdown、TXT、JSON、CSV 文件写入工作区。只创建人工审批单，不会立即修改磁盘文件。先提示用户到任务中心/API 审批。",
      parameters: Type.Object({ path: Type.String(), content: Type.String(), overwrite: Type.Optional(Type.Boolean()) }),
      execute: async (args, api, context) => {
        try {
          if (!workspace.enabled) return summary("工作区未启用。");
          const result = await api.commit(async tx => {
            const doc = await tx.doc(PendingActions);
            const key = api.conversationId + ":" + api.callId;
            if (Object.hasOwn(doc.calls, key)) {
              const previous = doc.items.find(item => item.id === doc.calls[key]);
            return previous ? { id: previous.id, name: previous.name } : null;
            }
            const proposal = proposeWrite(args, api.conversationId, api.callId);
            pruneActions(doc);
            doc.items.push(proposal);
            doc.calls[key] = proposal.id;
            return { id: proposal.id, name: proposal.name };
          }, context);
          if (!result) throw Error("审批单已过期");
          return summary("工作区写入待审批：" + result.id + "，目标：" + result.name + "。未得到批准前不会写入。");
        } catch (e) { return summary("提议未创建：" + cleanError(e)); }
      },
    }),
  ];
}
export class ActionService {
  constructor({ root, harness, context, workspace }) {
    this.root = root; this.harness = harness; this.context = context;
    this.workspace = workspace; this.active = false; this.timer = null;
  }
  async list({ withContent = false } = {}) {
    const doc = await this.harness.snapshot(PendingActions, this.context);
    const items = doc?.items ?? [];
    return items.map(x => withContent ? { ...x } : { ...stripContent(x), preview: x.content.slice(0, 160) });
  }
  async propose(input) {
    if (!this.workspace.enabled) throw Error("工作区未启用");
    const requestId = input?.requestId;
    if (requestId !== undefined && (typeof requestId !== "string" || !/^[a-zA-Z0-9:_-]{1,80}$/.test(requestId)))
      throw Error("requestId 格式无效");
    return this.root.commit(async tx => {
      const doc = await tx.doc(PendingActions);
      const key = requestId ? "http:" + requestId : null;
      const newProposal = proposeWrite(input, null, null);
      if (key && Object.hasOwn(doc.calls, key)) {
        const previous = doc.items.find(x => x.id === doc.calls[key]);
        if (!previous || previous.hash !== newProposal.hash || previous.name !== newProposal.name ||
          previous.overwrite !== newProposal.overwrite) throw Error("requestId 对应的写入内容不同");
        return stripContent(previous);
      }
      pruneActions(doc);
      doc.items.push(newProposal);
      if (key) doc.calls[key] = newProposal.id;
      return stripContent(newProposal);
    }, this.context);
  }
  async detail(id) {
    const docs = await this.list({ withContent: true });
    const item = docs.find(x => x.id === id);
    if (!item) throw Error("审批单不存在");
    return item;
  }
  async decide(id, decision) {
    if (!["approve", "reject"].includes(decision)) throw Error("审批操作无效");
    return this.root.commit(async tx => {
      const item = (await tx.doc(PendingActions)).items.find(x => x.id === id);
      if (!item) throw Error("审批单不存在");
      if (item.state !== "pending") throw Error("只有待审批的提议可修改");
      item.state = decision === "approve" ? "approved" : "rejected";
      item.updatedAt = Date.now();
      return stripContent(item);
    }, this.context);
  }
  async tick() {
    if (!this.workspace.enabled || this.active) return;
    this.active = true;
    try {
      for (let i = 0; i < 4; i++) {
        const task = await this.root.commit(async tx => {
          const doc = await tx.doc(PendingActions);
          const item = doc.items.find(x => x.state === "approved" ||
            (x.state === "executing" && x.leaseUntil < Date.now()));
          if (!item) return null;
          item.state = "executing"; item.leaseUntil = Date.now() + 60_000;
          item.attempts += 1; item.updatedAt = Date.now();
          return { ...item };
        }, this.context);
        if (!task) break;
        let state = "done", result = null, error = null;
        try { result = await this.workspace.writeApproved(task); }
        catch (e) { state = "failed"; error = cleanError(e); }
        await this.root.commit(async tx => {
          const item = (await tx.doc(PendingActions)).items.find(x => x.id === task.id);
          if (item?.state !== "executing") return;
          item.state = state; item.updatedAt = Date.now();
          item.result = result; item.error = error; item.leaseUntil = 0;
          item.bytes = Buffer.byteLength(item.content || "");
          item.content = ""; // 已终结动作不保留第二份全文，文件本身才是交付物
        }, this.context);
      }
    } finally { this.active = false; }
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(e => console.error("审批执行循环出错：", e?.name)), 2500);
    this.timer.unref?.();
    this.tick().catch(e => console.error("审批恢复出错：", e?.name));
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
export function openWorkspace() {
  return new FileWorkspace(process.env.WORKSPACE_ENABLED === "1" ? process.env.WORKSPACE_ROOT || "" : "");
}
