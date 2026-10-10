import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => resolve(port)); });
  });
}
async function boot(dir, port, sendPort) {
  let logs = "";
  const child = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, LLM_API: "faux", DATA_DIR: dir, PORT: String(port),
      NODE_ENV: "test", DEMO_PASSWORD: "testpassword",
      WECHAT_ENABLED: "1", WECHAT_WEBHOOK_KEY: "test-webhook-secret",
      WECHAT_SEND_TOKEN: "test-send-secret",
      WECHAT_SEND_URL: "http://127.0.0.1:" + sendPort + "/v1/send", NOTIFY_MODE: "off" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (x) => logs += x.toString());
  child.stderr.on("data", (x) => logs += x.toString());
  const origin = "http://127.0.0.1:" + port;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error("启动失败：" + logs);
    try {
      const r = await fetch(origin + "/api/info");
      if (r.status === 401) return { child, origin, logs: () => logs };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw Error("等待服务超时：" + logs);
}
async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000).unref();
  });
}

test("微信通道鉴权、幂等、会话持久化和自动回复", { timeout: 50000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-wechat-"));
  const port = await freePort();
  // Separate port server emulates wx-bot's local send API, not real iLink.
  const { createServer: createHTTPServer } = await import("node:http");
  const sent = [];
  const server = createHTTPServer(async (req, res) => {
    if (req.url !== "/v1/send" || req.headers.authorization !== "Bearer test-send-secret") {
      res.writeHead(401); return res.end();
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    sent.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let app;
  try {
    app = await boot(dir, port, server.address().port);
    const path = "/channels/wechat/incoming";
    const input = { binding: "primary", message_id: "9881", from_wxid: "wxid_test",
      text: "你好", media: [] };
    const post = (token, b = input) => fetch(app.origin + path, {
      method: "POST", headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify(b),
    });
    assert.equal((await post("Bearer wrong")).status, 401);
    const response = await post("Bearer test-webhook-secret");
    assert.equal(response.status, 202, app.logs());
    const { conversationId } = await response.json();
    const duplicate = await post("Bearer test-webhook-secret");
    assert.equal(duplicate.status, 202);
    assert.equal((await duplicate.json()).conversationId, conversationId);
    const emptyEvent = await post("Bearer test-webhook-secret", { ...input, message_id: "9882", text: "" });
    assert.equal(emptyEvent.status, 202);
    assert.equal((await emptyEvent.json()).ignored, true);
    const basic = "Basic " + Buffer.from("demo:testpassword").toString("base64");
    const status = await (await fetch(app.origin + "/api/wechat/status", { headers: { authorization: basic } })).json();
    assert.equal(status.bindings.length, 1);
    await stop(app.child);
    app = await boot(dir, port, server.address().port);
    const status2 = await (await fetch(app.origin + "/api/wechat/status", { headers: { authorization: basic } })).json();
    assert.equal(status2.bindings[0].conversationId, conversationId);
    for (let i = 0; i < 160 && sent.length === 0; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(sent.length, 1, "应自动发送一次：" + app.logs());
    assert.equal(sent[0].binding, "primary");
    assert.equal(sent[0].to, "wxid_test");
    assert.equal(sent[0].text, "演示任务完成。");
  } finally {
    if (app) await stop(app.child);
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
