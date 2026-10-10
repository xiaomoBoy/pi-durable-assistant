import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNet } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function freePort() {
  return new Promise((resolve, reject) => {
    const socket = createNet();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}
async function launch(port, dataDir, root, enabled = true) {
  let logs = "";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, LLM_API: "faux", DATA_DIR: dataDir, PORT: String(port),
      NODE_ENV: "production", DEMO_PASSWORD: "test-password", NOTIFY_MODE: "off",
      WECHAT_ENABLED: "0", OBSIDIAN_ROOT: enabled ? root : "",
      OBSIDIAN_ALLOWED_PATHS: "", OBSIDIAN_SOURCE_URL: "https://github.com/private/docs/blob/main" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (x) => { logs += x.toString(); });
  child.stderr.on("data", (x) => { logs += x.toString(); });
  const origin = "http://127.0.0.1:" + port;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw Error("服务提前退出：" + logs);
    try { const r = await fetch(origin + "/api/info"); if (r.status === 401) return { child, origin, logs: () => logs }; }
    catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill("SIGKILL");
  throw Error("服务启动超时：" + logs);
}
async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2500).unref();
  });
}
const auth = { authorization: "Basic " + Buffer.from("demo:test-password").toString("base64") };
test("知识库 API 必须鉴权，仅返回白名单内文件；重启后原内容不变", { timeout: 25000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-obsmount-"));
  const dataDir = await mkdtemp(join(tmpdir(), "pi-obsdb-"));
  const path = "My-VPS/我的VPS/X灵感/写作参考.md";
  await mkdir(join(root, "My-VPS/我的VPS/X灵感"), { recursive: true });
  await mkdir(join(root, "my-info/我的信息/副业经营"), { recursive: true });
  await writeFile(join(root, path), "---\nstatus: 现行\n---\n# X 写作参考\nPi 写作习惯：开头抓人，内容分点。");
  await writeFile(join(root, "my-info/我的信息/副业经营/副业战略.md"), "敏感经营信息");
  const port = await freePort();
  let app;
  try {
    app = await launch(port, dataDir, root);
    assert.equal((await fetch(app.origin + "/api/knowledge/status")).status, 401);
    assert.equal((await fetch(app.origin + "/api/knowledge/search?q=Pi")).status, 401);
    let res = await fetch(app.origin + "/api/knowledge/status", { headers: auth });
    assert.equal(res.status, 200);
    const status = await res.json();
    assert.equal(status.readOnly, true);
    assert.equal(status.files, 1);
    res = await fetch(app.origin + "/api/knowledge/search?q=" + encodeURIComponent("X 写作习惯"), { headers: auth });
    assert.equal(res.status, 200);
    const found = await res.json();
    assert.equal(found.hits[0].path, path);
    assert.equal(found.hits[0].status, "active");
    res = await fetch(app.origin + "/api/knowledge/read?path=" + encodeURIComponent(path) + "&line=4", { headers: auth });
    assert.equal(res.status, 200);
    assert.match((await res.json()).text, /写作参考/);
    res = await fetch(app.origin + "/api/knowledge/read?path=" + encodeURIComponent("my-info/我的信息/副业经营/副业战略.md"), { headers: auth });
    assert.equal(res.status, 403);
    res = await fetch(app.origin + "/api/knowledge/read?path=..%2F..%2Fetc%2Fpasswd", { headers: auth });
    assert.equal(res.status, 403);
    await stop(app.child);
    app = await launch(port, dataDir, root);
    res = await fetch(app.origin + "/api/knowledge/search?q=Pi", { headers: auth });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).hits[0].path, path);
  } catch (error) {
    console.error("知识库 HTTP 验收日志：", app?.logs?.());
    throw error;
  } finally {
    if (app) await stop(app.child);
    await rm(root, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});
test("知识库未挂载时仍保留正常聊天/API，且明确报告未配置", { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-obs-off-"));
  const port = await freePort();
  let app;
  try {
    app = await launch(port, dir, dir, false);
    let r = await fetch(app.origin + "/api/knowledge/status", { headers: auth });
    assert.equal((await r.json()).enabled, false);
    r = await fetch(app.origin + "/api/knowledge/search?q=Pi", { headers: auth });
    assert.equal(r.status, 503);
    r = await fetch(app.origin + "/api/info", { headers: auth });
    assert.equal(r.status, 200);
  } finally {
    if (app) await stop(app.child);
    await rm(dir, { recursive: true, force: true });
  }
});
