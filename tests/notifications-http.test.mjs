import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHTTP } from "node:http";
import { createServer as createTCP } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const auth = "Basic " + Buffer.from("demo:outbox-test-password").toString("base64");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const headers = { authorization: auth };
const jsonHeaders = { ...headers, "content-type": "application/json" };
async function freePort() {
  const server = createTCP();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}
async function launch(port, dataDir, webhookURL) {
  let logs = "";
  const proc = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, LLM_API: "faux",
      NODE_ENV: "test", DEMO_PASSWORD: "outbox-test-password", NOTIFY_MODE: "all",
      NOTIFY_WEBHOOK_KIND: "generic", NOTIFY_WEBHOOK_URL: webhookURL,
      WECHAT_ENABLED: "0", WORKSPACE_ENABLED: "0" },
    stdio: ["ignore","pipe","pipe"],
  });
  proc.stdout.on("data", x => { logs += x.toString(); });
  proc.stderr.on("data", x => { logs += x.toString(); });
  const origin = "http://127.0.0.1:" + port;
  for (let n = 0; n < 100; n++) {
    if (proc.exitCode != null) throw Error("服务退出：" + logs);
    try { const r = await fetch(origin + "/api/info", { headers }); if (r.status === 200) return { proc, origin, logs: () => logs }; }
    catch {}
    await sleep(100);
  }
  proc.kill("SIGKILL"); throw Error("服务启动超时：" + logs);
}
async function stop(proc) {
  if (!proc || proc.exitCode !== null) return;
  await new Promise(resolve => {
    proc.once("exit", resolve);
    proc.kill("SIGTERM");
    setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 2500).unref();
  });
}
async function post(base, path, payload) {
  const r = await fetch(base + path, { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(path + ": " + r.status + " " + await r.text());
  return r.json().catch(() => ({}));
}
test("后台任务与计划任务的通知入库、故障重试、进程重启恢复与 HTTP 鉴权", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-f3-outbox-"));
  const calls = [];
  let accept = false;
  const receiver = createHTTP(async (req, res) => {
    assert.equal(req.method, "POST");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push({ id: req.headers["x-pi-event-id"], payload });
    res.writeHead(accept ? 200 : 503, { "content-type": "application/json" });
    res.end(accept ? '{"ok":true}' : '{"error":"temporary"}');
  });
  await new Promise(r => receiver.listen(0, "127.0.0.1", r));
  const endpoint = "http://127.0.0.1:" + receiver.address().port + "/events";
  const port = await freePort();
  let app;
  try {
    app = await launch(port, dir, endpoint);
    assert.equal((await fetch(app.origin + "/api/notifications")).status, 401);
    const { id } = await post(app.origin, "/api/conversations", {});
    const bg = await post(app.origin, "/api/conversations/" + id + "/background", {
      text: "等待十秒然后完成后台任务", requestId: "notify-bg-recovery",
    });
    const schedule = await post(app.origin, "/api/conversations/" + id + "/schedules", {
      text: "执行一次周期通知测试", minutesFromNow: 0.25, everyMinutes: 0,
      requestId: "notify-sched-recovery",
    });
    assert.ok(bg.item.id && schedule.item.id);
    let pending = [];
    for (let n = 0; n < 180; n++) {
      const response = await fetch(app.origin + "/api/notifications", { headers });
      pending = (await response.json()).items;
      if (pending.some(x => x.id === "background:" + bg.item.id && x.attempts > 0) &&
          pending.some(x => x.id.startsWith("schedule:" + schedule.item.id + ":"))) break;
      await sleep(100);
    }
    assert.ok(pending.some(x => x.id === "background:" + bg.item.id && x.attempts > 0),
      "后台通知没有经过 503 失败重试");
    assert.ok(pending.some(x => x.id.startsWith("schedule:" + schedule.item.id + ":")),
      "计划通知没有持久化");
    assert.ok(pending.some(x => x.state !== "sent"));
    await stop(app.proc);
    accept = true;
    app = await launch(port, dir, endpoint);
    let delivered = [];
    for (let n = 0; n < 120; n++) {
      delivered = (await (await fetch(app.origin + "/api/notifications", { headers })).json()).items;
      if (delivered.filter(x => x.state === "sent").length >= 2) break;
      await sleep(100);
    }
    const background = delivered.find(x => x.id === "background:" + bg.item.id);
    const scheduled = delivered.find(x => x.id.startsWith("schedule:" + schedule.item.id + ":"));
    assert.equal(background?.state, "sent", "背景通知未恢复发送：" + app.logs());
    assert.equal(scheduled?.state, "sent", "计划通知未恢复发送：" + app.logs());
    assert.equal(delivered.filter(x => x.id === background.id).length, 1, "单个任务只能有一个队列记录");
    assert.ok(calls.some(x => x.id === background.id && x.payload.id === background.id),
      "接收端必须能按稳定 ID 去重");
    const status = await (await fetch(app.origin + "/api/notifications/status", { headers })).json();
    assert.equal(status.counts.sent >= 2, true);
    const unauthorizedRetry = await fetch(app.origin + "/api/notifications/retry", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: background.id }),
    });
    assert.equal(unauthorizedRetry.status, 401);
    const retrySent = await fetch(app.origin + "/api/notifications/retry", {
      method: "POST", headers: jsonHeaders,
      body: JSON.stringify({ id: background.id }),
    });
    assert.equal(retrySent.status, 409, "不能重投已经成功的通知");
  } finally {
    await stop(app?.proc);
    await new Promise(r => receiver.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
