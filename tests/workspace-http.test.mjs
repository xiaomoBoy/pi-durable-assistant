import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as netServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const auth = { authorization: "Basic " + Buffer.from("demo:acceptance-password").toString("base64") };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  return new Promise(resolve => {
    const server = netServer(); server.listen(0, "127.0.0.1", () => {
      const n = server.address().port; server.close(() => resolve(n));
    });
  });
}
async function launch(n, db, ws) {
  let log = "";
  const proc = spawn(process.execPath, ["server.mjs"], { cwd: process.cwd(),
    env: { ...process.env, PORT: String(n), DATA_DIR: db, LLM_API: "faux", NODE_ENV: "production",
      DEMO_PASSWORD: "acceptance-password", WORKSPACE_ENABLED: "1", WORKSPACE_ROOT: ws,
      WECHAT_ENABLED: "0", NOTIFY_MODE: "off" }, stdio: ["ignore","pipe","pipe"] });
  for (const pipe of [proc.stdout, proc.stderr]) pipe.on("data", chunk => { log += chunk.toString(); });
  for (let j = 0; j < 100; j++) {
    if (proc.exitCode != null) throw Error("服务退出：" + log);
    try {
      const r = await fetch("http://127.0.0.1:" + n + "/api/info", { headers: auth });
      if (r.status === 200) return { proc, origin: "http://127.0.0.1:" + n, logs: () => log };
    } catch {}
    await pause(100);
  }
  proc.kill("SIGKILL"); throw Error("启动超时：" + log);
}
async function stop(proc) {
  if (proc.exitCode !== null) return;
  await new Promise(resolve => {
    proc.once("exit", resolve); proc.kill("SIGTERM");
    setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 1800).unref();
  });
}
test("完整审批流程：未批准不写入、批准后写入、鉴权、崩溃重启可查询", { timeout: 24000 }, async () => {
  const db = await mkdtemp(join(tmpdir(), "pi-action-db-"));
  const ws = await mkdtemp(join(tmpdir(), "pi-action-ws-"));
  const n = await port();
  let app;
  try {
    app = await launch(n, db, ws);
    const path = "reports/acceptance.md";
    assert.equal((await fetch(app.origin + "/api/foundation/actions")).status, 401);
    let r = await fetch(app.origin + "/api/foundation/actions", { method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path, content: "# 审批后才能落盘", requestId: "repeat-1" }) });
    assert.equal(r.status, 201);
    const action = (await r.json()).action;
    assert.equal(action.state, "pending");
    assert.equal((await fetch(app.origin + "/api/workspace/files", { headers: auth })).status, 200);
    assert.deepEqual((await (await fetch(app.origin + "/api/workspace/files", { headers: auth })).json()).files, []);
    r = await fetch(app.origin + "/api/foundation/actions", { method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ path, content: "# 审批后才能落盘", requestId: "repeat-1" }) });
    assert.equal((await r.json()).action.id, action.id);
    r = await fetch(app.origin + "/api/foundation/actions/" + action.id + "/approve",
      { method: "POST", headers: { ...auth, origin: "http://evil.example" } });
    assert.equal(r.status, 403);
    r = await fetch(app.origin + "/api/foundation/actions/" + action.id + "/approve", { method: "POST", headers: auth });
    assert.equal(r.status, 200);
    for (let i = 0; i < 30; i++) {
      const doc = await (await fetch(app.origin + "/api/foundation/actions/" + action.id, { headers: auth })).json();
      if (doc.action.state === "done") break;
      await pause(150);
    }
    const detail = (await (await fetch(app.origin + "/api/foundation/actions/" + action.id, { headers: auth })).json()).action;
    assert.equal(detail.state, "done");
    assert.equal((await readFile(join(ws, path), "utf8")), "# 审批后才能落盘");
    r = await fetch(app.origin + "/api/workspace/download?name=" + encodeURIComponent(path), { headers: auth });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /attachment/);
    assert.equal(await r.text(), "# 审批后才能落盘");
    await stop(app.proc);
    app = await launch(n, db, ws);
    const recovered = (await (await fetch(app.origin + "/api/foundation/actions/" + action.id, { headers: auth })).json()).action;
    assert.equal(recovered.state, "done");
    assert.equal(recovered.attempts, 1);
    assert.equal((await readFile(join(ws, path), "utf8")), "# 审批后才能落盘");
  } finally {
    if (app) await stop(app.proc);
    await rm(db, { recursive: true, force: true });
    await rm(ws, { recursive: true, force: true });
  }
});
