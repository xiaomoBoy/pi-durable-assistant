// v3：周期任务、后台子 Agent、管理操作和可选 webhook。保留 1.1.0 API。
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Type } from "@earendil-works/pi-ai";
import { AssistantEntry, configure, defineDoc, defineExtension, defineTask, defineTool } from "@earendil-works/pi-durable";
import { nextOccurrence, normalizeSchedule, scheduleMatches, normalizeRequestId } from "./v3-utils.mjs";
import { queueNotificationInTx } from "./notifications.mjs";

const resultText = (value) => ({ content: [{ type: "text", text: value }] });
// Chord 的事务对象只在 commit 回调内有效；HTTP 不能直接序列化已结算的 overlay。
const detach = (value) => JSON.parse(JSON.stringify(value));
const finish = (result = null) => ({ status: "terminal", outcome: { status: "completed", result } });

export const Schedules = defineDoc({
  kind: "app.v3.schedules", version: 1, scope: "conversation", fork: "initial",
  initial: () => ({ items: [], applied: {} }),
});
export const Parents = defineDoc({
  kind: "app.v3.parents", version: 1, scope: "session",
  initial: () => ({ children: {} }),
});
export const BackgroundJobs = defineDoc({
  kind: "app.v3.background", version: 1, scope: "conversation", fork: "initial",
  initial: () => ({ items: [], applied: {} }),
});

export const ScheduleTask = defineTask({
  name: "app.v3.schedule", version: 1,
  initial: () => ({ phase: "sleep" }),
  phases: {
    sleep: async (task, runtime, context) => {
      const ms = task.input.at - Date.now();
      while (Date.now() < task.input.at) {
        await sleep(Math.min(60000, task.input.at - Date.now()), undefined, { signal: runtime.signal });
      }
      await runtime.commit(() => ({ status: "running", checkpoint: { phase: "fire" } }), context);
    },
    fire: async (task, runtime, context) => {
      // 取消、暂停或修改后，旧任务到期时不会产生消息。
      let shouldFire = false;
      await runtime.commit(async (tx) => {
        const item = (await tx.doc(Schedules, runtime.conversationId)).items.find((it) => it.id === task.input.scheduleId);
        shouldFire = scheduleMatches(item, task.input);
        return shouldFire ? { status: "running", checkpoint: { phase: "deliver" } } : finish("已跳过过期任务");
      }, context);
    },
    deliver: async (task, runtime, context) => {
      let current = false;
      await runtime.commit(async (tx) => {
        const item = (await tx.doc(Schedules, runtime.conversationId)).items.find((it) => it.id === task.input.scheduleId);
        current = scheduleMatches(item, task.input);
        return current ? undefined : finish("已取消或已更新");
      }, context);
      if (!current) return;
      const parent = await runtime.conversation(runtime.conversationId, context);
      await parent.submit({
        type: "input", content: "[计划任务] " + task.input.text,
        requestId: "schedule:" + task.input.scheduleId + ":" + task.input.at,
        whenBusy: "followUp",
      }, context);
      await runtime.commit(async (tx) => {
        const doc = await tx.doc(Schedules, runtime.conversationId);
        const item = doc.items.find((it) => it.id === task.input.scheduleId);
        if (scheduleMatches(item, task.input)) {
          item.runs += 1;
          item.lastRunAt = task.input.at;
          const nextAt = nextOccurrence(task.input.at, item.everyMinutes);
          if (nextAt !== null) {
            item.nextAt = nextAt;
            item.revision += 1;
            item.jobId = await tx.createTask(ScheduleTask, {
              scheduleId: item.id, text: item.text, at: nextAt, revision: item.revision,
            }, { ownership: { kind: "conversation" }, background: true });
          } else {
            item.nextAt = null;
            item.status = "completed";
          }
        }
        await queueNotificationInTx(tx, {
          id: "schedule:" + task.input.scheduleId + ":" + task.input.at,
          type: "schedule", text: "计划任务已触发：" + task.input.text,
        });
        return finish();
      }, context);
    },
  },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

export async function scheduleInTx(tx, conversationId, input, requestId) {
  requestId = normalizeRequestId(requestId);
  const doc = await tx.doc(Schedules, conversationId);
  if (requestId && Object.hasOwn(doc.applied ?? {}, requestId)) {
    const previous = doc.applied[requestId];
    return detach(doc.items.find((item) => item.id === previous.id) ?? previous);
  }
  const normalized = normalizeSchedule(input);
  const item = {
    id: randomUUID(), text: normalized.text, nextAt: normalized.at,
    everyMinutes: normalized.everyMinutes, runs: 0, lastRunAt: null,
    status: "active", revision: 1, createdAt: Date.now(),
  };
  item.jobId = await tx.createTask(ScheduleTask, {
    scheduleId: item.id, text: item.text, at: item.nextAt, revision: item.revision,
  }, { ownership: { kind: "conversation" }, background: true });
  doc.items.push(item);
  if (requestId) (doc.applied ??= {})[requestId] = item;
  return detach(item);
}

export async function manageScheduleInTx(tx, conversationId, id, action) {
  const item = (await tx.doc(Schedules, conversationId)).items.find((it) => it.id === id);
  if (!item) throw new Error("计划任务不存在");
  if (action === "cancel" && item.status !== "completed") {
    item.status = "cancelled";
    item.revision += 1;
  } else if (action === "pause" && item.status === "active") {
    item.status = "paused";
    item.revision += 1;
  } else if (action === "resume" && item.status === "paused") {
    item.status = "active";
    item.revision += 1;
    // 恢复时保留未来的截止时间；过去的截止时间改成 1 分钟后。
    item.nextAt = Math.max(item.nextAt || 0, Date.now() + 60000);
    item.jobId = await tx.createTask(ScheduleTask, {
      scheduleId: item.id, text: item.text, at: item.nextAt, revision: item.revision,
    }, { ownership: { kind: "conversation" }, background: true });
  } else {
    throw new Error("当前状态不能执行该操作");
  }
  return detach(item);
}

export const BackgroundTask = defineTask({
  name: "app.v3.background-agent", version: 1,
  initial: () => ({ phase: "start" }),
  phases: {
    start: async (task, runtime, context) => {
      await runtime.commit(async (tx) => {
        const item = (await tx.doc(BackgroundJobs, runtime.conversationId)).items.find((it) => it.id === task.input.jobId);
        if (item?.status === "cancelled") return finish("已取消");
        const existing = (await tx.scanConversations({ ownerTaskId: task.id }, 1)).items[0];
        let childId = existing?.id;
        if (childId === undefined) {
          const child = await tx.createConversation({ ownership: { kind: "task", taskId: task.id } });
          childId = child.id;
          await configure(tx, childId, {
            extensions: { remove: [V3] },
            instructions: "你是后台子 Agent。只执行交给你的任务，简洁汇报结果，不要再委派后台子 Agent。",
          });
        }
        if (item) item.conversationId = childId;
        const parents = await tx.doc(Parents);
        parents.children[childId] = runtime.conversationId;
        return { status: "running", checkpoint: { phase: "wait", childId } };
      }, context);
    },
    wait: async (task, runtime, context) => {
      const child = await runtime.conversation(task.state.checkpoint.childId, context);
      const submission = await child.submit({
        type: "input", content: task.input.text, requestId: "background:" + task.input.jobId,
      }, context);
      const settled = await submission.wait(context);
      await runtime.commit(async (tx) => {
        const item = (await tx.doc(BackgroundJobs, runtime.conversationId)).items.find((it) => it.id === task.input.jobId);
        if (item?.status === "cancelled") return finish("已取消");
        const failed = settled.status !== "done" || settled.type !== "input";
        let answer = "";
        if (!failed) {
          const parts = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0]?.content ?? [];
          answer = parts.filter((p) => p.type === "text").map((p) => p.text).join("").slice(0, 4000);
        }
        const summary = failed
          ? "后台子 Agent 未完成：" + (settled.reason || settled.status)
          : (answer || "任务已完成，没有文字结果");
        return { status: "running", checkpoint: { phase: "report", summary, failed } };
      }, context);
    },
    report: async (task, runtime, context) => {
      const checkpoint = task.state.checkpoint;
      let cancelled = false;
      await runtime.commit(async (tx) => {
        const item = (await tx.doc(BackgroundJobs, runtime.conversationId)).items.find((it) => it.id === task.input.jobId);
        cancelled = !item || item.status === "cancelled";
        return cancelled ? finish("已取消") : undefined;
      }, context);
      if (cancelled) return;
      const parent = await runtime.conversation(runtime.conversationId, context);
      await parent.submit({
        type: "input", content: "[后台任务结果] " + task.input.text + "\n" + checkpoint.summary,
        requestId: "background-report:" + task.input.jobId, whenBusy: "followUp",
      }, context);
      await runtime.commit(async (tx) => {
        const item = (await tx.doc(BackgroundJobs, runtime.conversationId)).items.find((it) => it.id === task.input.jobId);
        if (item && item.status !== "cancelled") {
          item.status = checkpoint.failed ? "failed" : "done";
          item.result = checkpoint.summary;
          item.finishedAt = Date.now();
        }
        await queueNotificationInTx(tx, {
          id: "background:" + task.input.jobId, type: "background",
          text: (checkpoint.failed ? "后台任务失败：" : "后台任务完成：") +
            task.input.text + "\n" + checkpoint.summary,
          failed: checkpoint.failed,
        });
        return finish();
      }, context);
    },
  },
  abort: (_task, runtime, context) => runtime.commit(async (tx) => {
    const item = (await tx.doc(BackgroundJobs, runtime.conversationId)).items.find((it) => it.id === _task.input.jobId);
    if (item && item.status === "running") item.status = "cancelled";
    return { status: "terminal", outcome: { status: "aborted" } };
  }, context),
});

export async function backgroundInTx(tx, conversationId, input, requestId) {
  requestId = normalizeRequestId(requestId);
  const doc = await tx.doc(BackgroundJobs, conversationId);
  if (requestId && Object.hasOwn(doc.applied ?? {}, requestId)) {
    const previous = doc.applied[requestId];
    return detach(doc.items.find((item) => item.id === previous.id) ?? previous);
  }
  const text = String(input?.text ?? "").trim();
  if (!text || text.length > 4000) throw new Error("后台任务说明必须是 1～4000 字");
  const item = { id: randomUUID(), text, status: "running", conversationId: null, createdAt: Date.now(), result: null };
  item.taskId = await tx.createTask(BackgroundTask, { jobId: item.id, text },
    { ownership: { kind: "conversation" }, background: true });
  doc.items.push(item);
  if (requestId) (doc.applied ??= {})[requestId] = item;
  return detach(item);
}

export const V3 = defineExtension({
  name: "v3-task-center",
  tasks: [ScheduleTask, BackgroundTask],
  tools: [
    defineTool({
      name: "schedule_task", replay: "safe",
      description: "在指定分钟后执行任务，可按固定间隔重复；everyMinutes 为 0 时只执行一次",
      parameters: Type.Object({
        text: Type.String(), minutesFromNow: Type.Number(),
        everyMinutes: Type.Optional(Type.Number()),
      }),
      execute: async (args, api, context) => {
        const item = await api.commit((tx) => scheduleInTx(tx, api.conversationId, args, "tool:" + api.callId), context);
        return resultText("计划已创建：" + item.id);
      },
    }),
    defineTool({
      name: "delegate_background", replay: "safe",
      description: "把一项独立工作交给可跨进程恢复的后台子 Agent，立即返回任务编号，不等待它完成",
      parameters: Type.Object({ text: Type.String() }),
      execute: async (args, api, context) => {
        const item = await api.commit((tx) => backgroundInTx(tx, api.conversationId, args, "tool:" + api.callId), context);
        return resultText("后台子 Agent 已启动：" + item.id);
      },
    }),
  ],
});
