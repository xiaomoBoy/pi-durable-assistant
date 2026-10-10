// 模型接入、Documents、工具和 Harness 的组装
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createModels, createProvider, envApiKeyAuth, Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { AssistantEntry, configure, createRegistry, defineDoc, defineExtension, defineTask, defineTool, Harness, section } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { fetchPublicPage } from "./net.mjs";
import { V3, notifyEvent } from "./v3.mjs";
import { openWorkspace, workspaceTools } from "./actions.mjs";

export const config = {
	port: Number(process.env.PORT || 3000),
	dataDir: process.env.DATA_DIR || "./data",
	password: process.env.DEMO_PASSWORD || "",
	api: process.env.LLM_API || "openai-completions",
	baseUrl: process.env.LLM_BASE_URL || "",
	model: process.env.LLM_MODEL || "",
	contextWindow: Number(process.env.LLM_CONTEXT_WINDOW || 128000),
	maxTokens: Number(process.env.LLM_MAX_TOKENS || 8192),
};

// 每个会话的记事本：Agent 自己维护的待办和备忘。fork 时继承分叉那一刻的内容。
export const Notes = defineDoc({
	kind: "app.notes",
	version: 1,
	scope: "conversation",
	history: "rewindable",
	fork: "asOf",
	initial: () => ({ todos: [], memos: [], applied: {} }),
});

// 会话列表：官方没有列出会话的接口，自己记一份
export const Index = defineDoc({
	kind: "app.index",
	version: 1,
	scope: "session",
	initial: () => ({ items: [] }),
});

// 进程信息：每次启动 boots + 1，用来在页面上证明进程重启过
// 本会话设的定时提醒
export const Reminders = defineDoc({
	kind: "app.reminders",
	version: 1,
	scope: "conversation",
	fork: "initial",
	initial: () => ({ items: [], applied: {} }),
});

// 本会话派出的子 Agent
export const Delegations = defineDoc({
	kind: "app.delegations",
	version: 1,
	scope: "conversation",
	fork: "initial",
	initial: () => ({ items: [] }),
});

export const Meta = defineDoc({
	kind: "app.meta",
	version: 1,
	scope: "session",
	initial: () => ({ boots: 0, lastBootAt: null }),
});

const API_LOADERS = {
	"openai-completions": async () => (await import("@earendil-works/pi-ai/api/openai-completions.lazy")).openAICompletionsApi(),
	"openai-responses": async () => (await import("@earendil-works/pi-ai/api/openai-responses.lazy")).openAIResponsesApi(),
	"anthropic-messages": async () => (await import("@earendil-works/pi-ai/api/anthropic-messages.lazy")).anthropicMessagesApi(),
};

async function createModelCatalog() {
	const models = createModels();
	if (config.api === "faux") {
		const faux = fauxProvider();
		faux.setResponses(Array(1000).fill(fauxScript));
		models.setProvider(faux.provider);
		return { models, agentModel: { provider: "faux", modelId: "faux-1" }, label: "faux（本地演示剧本）" };
	}
	const loadApi = API_LOADERS[config.api];
	if (!loadApi) throw new Error(`不支持的 LLM_API：${config.api}`);
	if (!config.baseUrl || !config.model) throw new Error("缺少 LLM_BASE_URL 或 LLM_MODEL");
	const model = {
		id: config.model,
		name: config.model,
		api: config.api,
		provider: "demo",
		baseUrl: config.baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: config.contextWindow,
		maxTokens: config.maxTokens,
		// 走未知中转，保守关闭可能不支持的字段
		...(config.api === "openai-completions" ? { compat: { supportsStore: false, supportsDeveloperRole: false } } : {}),
	};
	const provider = createProvider({
		id: "demo",
		name: "Demo",
		baseUrl: config.baseUrl,
		auth: { apiKey: envApiKeyAuth("Demo API key", ["LLM_API_KEY"]) },
		models: [model],
		api: await loadApi(),
	});
	models.setProvider(provider);
	return { models, agentModel: { provider: "demo", modelId: config.model }, label: config.model };
}

// faux 剧本：按最后一条用户消息之后助手已经回了几次，依次列待办、等待、勾完、回答
function fauxScript(context) {
	const messages = context.messages;
	const lastUser = messages.findLastIndex((m) => m.role === "user");
	const replies = messages.slice(lastUser + 1).filter((m) => m.role === "assistant").length;
	const steps = ["第一步：查资料", "第二步：等待 10 秒", "第三步：整理结论"];
	const toolUse = { stopReason: "toolUse" };
	if (replies === 0) return fauxAssistantMessage(steps.map((text) => fauxToolCall("todo", { action: "add", text })), toolUse);
	if (replies === 1) return fauxAssistantMessage([fauxToolCall("wait_seconds", { seconds: 10, reason: "演示长任务" })], toolUse);
	if (replies === 2) return fauxAssistantMessage(steps.map((text) => fauxToolCall("todo", { action: "done", text })), toolUse);
	return fauxAssistantMessage("演示任务完成。");
}

// 1.1.0 发布版的字段是 content（README 里的 output 是更新的写法）
const text = (value) => ({ content: [{ type: "text", text: value }] });

function htmlToText(html) {
	return html
		.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

export const workspace = openWorkspace();
const workspaceFileTools = workspaceTools(workspace);

const fetchPage = defineTool({
	name: "fetch_page",
	description: "抓取一个公开网页的正文文字（最多 6000 字）",
	parameters: Type.Object({ url: Type.String({ description: "http 或 https 地址" }) }),
	replay: "safe",
	execute: async (args, _api, callContext) => {
		const page = await fetchPublicPage(args.url, callContext.abortSignal);
		return text(`HTTP ${page.status}\n${htmlToText(page.text).slice(0, 6000)}`);
	},
});

const waitSeconds = defineTool({
	name: "wait_seconds",
	description: "等待一段时间再继续（1 到 120 秒），用于定时、隔一会儿再检查之类的任务",
	parameters: Type.Object({ seconds: Type.Number(), reason: Type.Optional(Type.String()) }),
	replay: "safe",
	execute: async (args, api, callContext) => {
		const seconds = Math.min(120, Math.max(1, Math.round(args.seconds)));
		// 截止时间存进任务备忘：崩溃重启后按原截止时间接着等，而不是从头等
		const deadline = await api.memo("deadline", Date.now() + seconds * 1000, callContext);
		while (Date.now() < deadline) {
			api.output(`还剩 ${Math.ceil((deadline - Date.now()) / 1000)} 秒\n`);
			// 点“停止”时立即结束等待
			await sleep(Math.min(1000, deadline - Date.now()), undefined, { signal: callContext.abortSignal });
		}
		return text(`已等待 ${seconds} 秒`);
	},
});

// 改记事本的工具可以安全重放：同一次调用的结果和修改在同一个事务里记下，重放时直接返回记录，不会重复写
async function applyOnce(api, callContext, change) {
	return api.commit(async (tx) => {
		const notes = await tx.doc(Notes, api.conversationId);
		notes.applied ??= {};
		if (api.callId in notes.applied) return notes.applied[api.callId];
		const result = change(notes);
		notes.applied[api.callId] = result;
		return result;
	}, callContext);
}

const todo = defineTool({
	name: "todo",
	description: "维护待办：add 新增一条，done 把匹配的一条标记完成",
	parameters: Type.Object({ action: Type.Union([Type.Literal("add"), Type.Literal("done")]), text: Type.String() }),
	replay: "safe",
	execute: async (args, api, callContext) => {
		const result = await applyOnce(api, callContext, (notes) => {
			if (args.action === "add") {
				notes.todos.push({ text: args.text, done: false });
				return `已添加：${args.text}`;
			}
			const item = notes.todos.find((t) => !t.done && t.text === args.text) ?? notes.todos.find((t) => !t.done && t.text.includes(args.text));
			if (!item) return `没找到待办：${args.text}`;
			item.done = true;
			return `已完成：${item.text}`;
		});
		return text(result);
	},
});

const memo = defineTool({
	name: "memo",
	description: "记一条需要长期记住的备忘",
	parameters: Type.Object({ text: Type.String() }),
	replay: "safe",
	execute: async (args, api, callContext) => {
		const result = await applyOnce(api, callContext, (notes) => {
			notes.memos.push(args.text);
			return `已记下：${args.text}`;
		});
		return text(result);
	},
});

const currentTime = defineTool({
	name: "current_time",
	description: "获取当前北京时间",
	parameters: Type.Object({}),
	replay: "safe",
	execute: async () => text(new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })),
});

// 定时提醒：后台持久任务。先睡到点，再把提醒作为 follow-up 输入投回会话，Agent 会主动开口。
// 进程重启后任务从存储里恢复，接着睡剩下的时间；关掉网页也不影响。
const ReminderTask = defineTask({
	name: "app.reminder",
	version: 1,
	initial: () => ({ phase: "sleep" }),
	phases: {
		sleep: async (task, runtime, taskContext) => {
			const ms = task.input.at - Date.now();
			if (ms > 0) await sleep(ms, undefined, { signal: runtime.signal });
			await runtime.commit(async (tx) => {
				const doc = await tx.doc(Reminders, runtime.conversationId);
				const reminder = doc.items.find((item) => item.id === task.id);
				return reminder?.status === "cancelled"
					? { status: "terminal", outcome: { status: "aborted" } }
					: { status: "running", checkpoint: { phase: "fire" } };
			}, taskContext);
		},
		fire: async (task, runtime, taskContext) => {
			let cancelled = false;
			await runtime.commit(async (tx) => {
				const item = (await tx.doc(Reminders, runtime.conversationId)).items.find((i) => i.id === task.id);
				cancelled = !item || item.status === "cancelled";
				return cancelled ? { status: "terminal", outcome: { status: "aborted" } } : undefined;
			}, taskContext);
			if (cancelled) return;
			const conversation = await runtime.conversation(runtime.conversationId, taskContext);
			// requestId 保证重启后不会重复提醒
			await conversation.submit(
				{ type: "input", content: `[定时提醒] ${task.input.text}`, whenBusy: "followUp", requestId: `reminder:${task.id}` },
				taskContext,
			);
			await runtime.commit(async (tx) => {
				const item = (await tx.doc(Reminders, runtime.conversationId)).items.find((i) => i.id === task.id);
				if (item) item.status = "fired";
				return { status: "terminal", outcome: { status: "completed", result: null } };
			}, taskContext);
			await notifyEvent({ id: "reminder:" + task.id, type: "reminder", text: "定时提醒：" + task.input.text });
		},
	},
	abort: (_task, runtime, taskContext) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext),
});

const remindMe = defineTool({
	name: "remind_me",
	description: "设一个定时提醒：到点后你会收到一条以 [定时提醒] 开头的消息，再去提醒用户。minutes 可以是小数，0.25 到 1440",
	parameters: Type.Object({ minutes: Type.Number(), text: Type.String({ description: "要提醒的事" }) }),
	replay: "safe",
	execute: async (args, api, callContext) => {
		const minutes = Math.min(1440, Math.max(0.25, args.minutes));
		const result = await api.commit(async (tx) => {
			const reminders = await tx.doc(Reminders, api.conversationId);
			if (api.callId in reminders.applied) return reminders.applied[api.callId];
			const at = Date.now() + Math.round(minutes * 60_000);
			// 后台任务：不算进当前回答，点“停止”也不会取消它
			const id = await tx.createTask(ReminderTask, { at, text: args.text }, { ownership: { kind: "conversation" }, background: true });
			reminders.items.push({ id, text: args.text, at, status: "scheduled" });
			const when = new Date(at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
			return (reminders.applied[api.callId] = `已设好提醒：${when}（北京时间）提醒“${args.text}”`);
		}, callContext);
		return text(result);
	},
});

// 子 Agent：由这次工具调用拥有的子会话，独立干完一件事再把结果交回来。写法照官方 README 的 subagent 示例
const Delegate = defineExtension({
	name: "delegate",
	tools: [
		defineTool({
			name: "delegate",
			description: "派一个子 Agent 独立完成一件事（比如调研一个网页），等它做完拿回结果。适合可以单独完成、步骤较多的任务",
			parameters: Type.Object({ task: Type.String({ description: "交给子 Agent 的完整任务说明" }) }),
			replay: "safe",
			execute: async (args, api, callContext) => {
				const childId = await api.commit(async (tx) => {
					// 重放时找回已经建过的子会话，不会重复建
					const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
					if (existing !== undefined) return existing.id;
					const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
					await configure(tx, created.id, {
						extensions: { remove: [Delegate] },
						instructions: "你是主 Agent 派出的子 Agent，只负责完成交给你的这一件事，完成后用简短中文汇报结果。",
					});
					(await tx.doc(Delegations, api.conversationId)).items.push({ conversationId: created.id, task: args.task, status: "running" });
					const index = await tx.doc(Index);
					index.children ??= {};
					index.children[created.id] = api.conversationId;
					return created.id;
				}, callContext);
				await api.details({ conversationId: childId }, callContext);
				const child = await api.conversation(childId, callContext);
				const submission = await child.submit({ type: "input", content: args.task, requestId: `delegate:${api.taskId}` }, callContext);
				const settled = await submission.wait(callContext);
				const answer = await api.commit(async (tx) => {
					const item = (await tx.doc(Delegations, api.conversationId)).items.find((i) => i.conversationId === childId);
					if (item) item.status = "done";
					if (settled.status !== "done" || settled.type !== "input") return `子 Agent 没有完成：${settled.reason ?? settled.status}`;
					const content = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0]?.content ?? [];
					return content.filter((c) => c.type === "text").map((c) => c.text).join("") || "子 Agent 完成了，但没有文字结果";
				}, callContext);
				return text(answer);
			},
		}),
	],
});

const Assistant = defineExtension({
	name: "assistant",
	tools: [fetchPage, ...workspaceFileTools, waitSeconds, todo, memo, currentTime, remindMe],
	tasks: [ReminderTask],
	sections: [
		section(
			"preamble",
			() =>
				[
					"你是“小墨的 Durable 助手”，用简体中文简洁回答。",
					"遇到多步骤任务，先用 todo 列出步骤，做完一步标记一步。",
					"当场等一会儿再继续用 wait_seconds；几分钟以后才要做的事用 remind_me 设提醒，不要用 wait_seconds 干等。",
					"收到以 [定时提醒] 开头的消息时，那是你之前设的提醒到点了，用一两句话提醒用户这件事。",
					"能独立完成、步骤较多的调研可以用 delegate 派给子 Agent；需要后台独立运行用 delegate_background。",
					"有周期性或延迟执行的需求用 schedule_task，按固定分钟间隔执行。",
					"需要长期记住的信息用 memo。查网页用 fetch_page。",
					"工作区文件只能通过 workspace_list 和 workspace_read 查看；写入必须使用 propose_workspace_write 生成待审批操作，只有用户明确批准才能落盘。不要声称提议已写入。工作区不是你的 Obsidian 知识库，不要请求执行任意 shell 命令。",
				].join("\n"),
			{ tag: false },
		),
		section("notes", async (input, renderContext) => {
			const notes = await input.read.snapshot(Notes, input.conversationId, renderContext);
			if (!notes || (notes.todos.length === 0 && notes.memos.length === 0)) return undefined;
			const todos = notes.todos.map((t) => `${t.done ? "[x]" : "[ ]"} ${t.text}`);
			const memos = notes.memos.map((m) => `- ${m}`);
			return ["当前记事本：", ...todos, ...memos].join("\n");
		}),
	],
});

const redactKey = (value) => {
	const key = process.env.LLM_API_KEY || "";
	return key.length >= 8 ? String(value).replaceAll(key, "***") : String(value);
};

export async function openAgent(context) {
	await mkdir(config.dataDir, { recursive: true });
	const { models, agentModel, label } = await createModelCatalog();
	const registry = createRegistry();
	registry.install(Assistant);
	registry.install(Delegate);
	registry.install(V3);
	const storage = await openNodeSqliteStorage(join(config.dataDir, "agent.sqlite"));
	// 1.1.0 发布版还没有 README 里的 harness.closed，非致命错误从 onReport 打日志
	const harness = await Harness.open(storage, { models, registry, onReport: (error) => console.error("Harness 报告：", redactKey(error?.message ?? error)) }, context);
	// 根会话只用来写会话库级 Document，不出现在列表里
	const root = await harness.root(context, { agent: { model: agentModel } });
	await root.commit(async (tx) => {
		const meta = await tx.doc(Meta);
		meta.boots += 1;
		meta.lastBootAt = new Date().toISOString();
	}, context);
	// 继续上个进程没做完的任务
	harness.resume();
	return { harness, root, agentModel, modelLabel: label };
}
