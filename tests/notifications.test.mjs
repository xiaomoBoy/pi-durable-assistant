import test from "node:test";
import assert from "node:assert/strict";
import { NotificationOutbox, NotificationService, notificationPayload, notificationSettings,
  queueNotificationInTx, retryDelayMs, shouldQueue, pruneOutbox } from "../lib/notifications.mjs";

function fakeDurable(clock = () => 1_000_000) {
  const store = { items: [] };
  const tx = { doc: async (definition) => {
    assert.equal(definition, NotificationOutbox);
    return store;
  } };
  const root = { commit: async fn => fn(tx) };
  const harness = { snapshot: async () => store };
  const service = opts => new NotificationService({
    root, harness, context: {}, clock, intervalMs: 999999,
    env: { NOTIFY_MODE: "all", NOTIFY_WEBHOOK_KIND: "generic",
      NOTIFY_WEBHOOK_URL: "https://example.invalid/hook" }, ...opts,
  });
  return { store, tx, service };
}
const evt = (id = "background:test-1") =>
  ({ id, type: "background", text: "后台任务完成", failed: false });

test("通知策略：默认仅失败，显式关闭/不配置 URL 不生成事件", async () => {
  assert.deepEqual(notificationSettings({}), { mode: "errors", kind: "generic", url: "", enabled: false });
  assert.equal(shouldQueue(evt(), notificationSettings({ NOTIFY_MODE: "errors",
    NOTIFY_WEBHOOK_URL: "https://example.invalid/hook" })), false);
  assert.equal(shouldQueue({ ...evt(), failed: true }, notificationSettings({
    NOTIFY_MODE: "errors", NOTIFY_WEBHOOK_URL: "https://example.invalid/hook" })), true);
  assert.equal(shouldQueue(evt(), notificationSettings({
    NOTIFY_MODE: "off", NOTIFY_WEBHOOK_URL: "https://example.invalid/hook" })), false);
  assert.throws(() => notificationSettings({ NOTIFY_MODE: "everything" }), /只能/);
  assert.throws(() => notificationSettings({ NOTIFY_MODE: "all",
    NOTIFY_WEBHOOK_KIND: "unknown" }), /只能/);
  assert.throws(() => notificationSettings({ NOTIFY_MODE: "all",
    NOTIFY_WEBHOOK_URL: "http://example.invalid/hook", NODE_ENV: "production" }), /HTTPS/);
});
test("在同一事务入队；幂等、payload、飞书格式和无凭据记录", async () => {
  const { store, tx } = fakeDurable();
  const settings = notificationSettings({ NOTIFY_MODE: "all", NOTIFY_WEBHOOK_URL: "https://example.invalid/hook" });
  assert.equal(await queueNotificationInTx(tx, evt(), settings), true);
  assert.equal(await queueNotificationInTx(tx, evt(), settings), false);
  assert.equal(store.items.length, 1);
  assert.equal(store.items[0].state, "pending");
  assert.equal(store.items[0].kind, "generic");
  assert.deepEqual(Object.keys(notificationPayload(store.items[0])).sort(),
    ["at", "failed", "id", "text", "type"].sort());
  assert.equal("url" in store.items[0], false);
  const feishu = notificationPayload({ ...store.items[0], kind: "feishu" });
  assert.equal(feishu.msg_type, "text");
  assert.equal(feishu.content.text, "后台任务完成");
  await assert.rejects(queueNotificationInTx(tx, { ...evt(), id: "bad event id" }, settings), /不合法/, "key validation");
});
test("发送失败指数退避，下一次成功后不重复发送", async () => {
  let now = 1_000_000, count = 0;
  const { store, tx, service } = fakeDurable(() => now);
  const env = { NOTIFY_MODE: "all", NOTIFY_WEBHOOK_URL: "https://example.invalid/hook" };
  await queueNotificationInTx(tx, evt("background:fail-then-ok"), notificationSettings(env), now);
  const dispatcher = service({ env, random: () => 0.5,
    fetchImpl: async () => { count++; return { status: count === 1 ? 503 : 200, ok: count !== 1 }; } });
  await dispatcher.tick();
  assert.equal(store.items[0].state, "pending");
  assert.equal(store.items[0].attempts, 1);
  assert.equal(store.items[0].nextAt, now + 2000);
  assert.equal(count, 1);
  await dispatcher.tick();
  assert.equal(count, 1);
  now += 2000;
  await dispatcher.tick();
  assert.equal(count, 2);
  assert.equal(store.items[0].state, "sent");
  assert.equal(store.items[0].attempts, 2);
  await dispatcher.tick();
  assert.equal(count, 2);
  assert.ok(retryDelayMs(8, () => 0.5) < 30 * 60_001);
});
test("HTTP 401 永久失败，必须手动重试才可重发", async () => {
  let now = 10_000, count = 0;
  const { store, tx, service } = fakeDurable(() => now);
  const dispatcher = service({
    fetchImpl: async () => ({ ok: ++count > 1, status: count > 1 ? 200 : 401 }),
  });
  await queueNotificationInTx(tx, evt("reminder:manual"), dispatcher.config(), now);
  await dispatcher.tick();
  assert.equal(store.items[0].state, "blocked");
  await dispatcher.tick();
  assert.equal(count, 1);
  await assert.rejects(dispatcher.retry("no-such-event"), /不存在/);
  await dispatcher.retry("reminder:manual");
  await dispatcher.tick();
  assert.equal(store.items[0].state, "sent");
  assert.equal(count, 2);
  await assert.rejects(dispatcher.retry("reminder:manual"), /只有阻断/);
});
test("崩溃后的 sending lease 到期可恢复；发送可能重复但事件 ID 稳定", async () => {
  let now = 1_000_000, observed = 0;
  const { store, tx, service } = fakeDurable(() => now);
  await queueNotificationInTx(tx, evt("schedule:once:123"), notificationSettings({
    NOTIFY_MODE: "all", NOTIFY_WEBHOOK_URL: "https://example.invalid/hook" }), now);
  const first = service({});
  const claimed = await first.claim();
  assert.equal(claimed.id, "schedule:once:123");
  assert.equal(store.items[0].state, "sending");
  const afterRestart = service({ fetchImpl: async (_url, args) => {
    observed++; assert.equal(args.headers["x-pi-event-id"], "schedule:once:123");
    return { status: 200, ok: true };
  } });
  await afterRestart.tick();
  assert.equal(observed, 0);
  now += 30_001;
  await afterRestart.tick();
  assert.equal(observed, 1);
  assert.equal(store.items[0].state, "sent");
  assert.equal(store.items[0].attempts, 2);
});
test("暂停发送不删除 backlog，历史清理不删失败/待发事件", async () => {
  let now = 1_000_000;
  const { store, tx, service } = fakeDurable(() => now);
  const on = notificationSettings({ NOTIFY_MODE: "all", NOTIFY_WEBHOOK_URL: "https://example.invalid/hook" });
  await queueNotificationInTx(tx, evt("background:pause"), on, now);
  const paused = service({ env: { NOTIFY_MODE: "off", NOTIFY_WEBHOOK_URL: "https://example.invalid/hook" },
    fetchImpl: () => { throw Error("must not send"); } });
  await paused.tick();
  assert.equal(store.items[0].state, "pending");
  store.items.push({ ...store.items[0], id: "background:sent-old", state: "sent",
    updatedAt: now - 8 * 86400_000 });
  pruneOutbox(store, now);
  assert.deepEqual(store.items.map(x => x.id), ["background:pause"]);
});

test("飞书 HTTP 200 仍需检查业务 code；非 0 不能误判送达", async () => {
  let now = 1_000_000;
  let valid = false;
  const { tx, store, service } = fakeDurable(() => now);
  const env = { NOTIFY_MODE: "all", NOTIFY_WEBHOOK_KIND: "feishu",
    NOTIFY_WEBHOOK_URL: "https://example.invalid/feishu" };
  await queueNotificationInTx(tx, evt("background:feishu-code"), notificationSettings(env), now);
  const worker = service({ env, random: () => 0.5, fetchImpl: async () => ({
    ok: true, status: 200, json: async () => valid ? { code: 0 } : { code: 19021, msg: "business error" },
  }) });
  await worker.tick();
  assert.equal(store.items[0].state, "pending", "飞书 code 非零时不能记为 sent");
  assert.equal(store.items[0].lastStatus, 503);
  valid = true;
  now += 2000;
  await worker.tick();
  assert.equal(store.items[0].state, "sent");
});
