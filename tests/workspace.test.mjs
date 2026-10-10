import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileWorkspace, proposeWrite, validateName } from "../lib/workspace.mjs";

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "durable-workspace-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test("默认关闭且禁止跨目录、隐藏文件和命令型文件", async () => {
  assert.equal(new FileWorkspace().enabled, false);
  for (const name of ["../escape.md", "/etc/passwd.md", "a/../b.md", ".env", "x/.keys.md",
    "a\\b.md", "x/run.sh", "foo.js", "foo.mjs", "a//b.md", "a/.hidden/x.md"]) {
    assert.throws(() => validateName(name), /非法|不支持/);
  }
  await assert.rejects(new FileWorkspace().list(), /未启用/);
});
test("只读文件列表和读取；没有审批不会产生写入", async () => fixture(async dir => {
  const ws = new FileWorkspace(dir);
  await mkdir(join(dir, "notes"));
  await writeFile(join(dir, "notes", "existing.md"), "原有内容");
  const proposal = proposeWrite({ path: "notes/result.md", content: "# 实验结果" }, 1, "call-id");
  assert.equal(proposal.state, "pending");
  assert.deepEqual(await ws.list(), ["notes/existing.md"]);
  assert.equal((await ws.read("notes/existing.md")).content, "原有内容");
  await assert.rejects(ws.read(proposal.name), /不存在/);
}));
test("审批后的写入可重复执行、保持相同摘要且拒绝越权覆盖", async () => fixture(async dir => {
  const ws = new FileWorkspace(dir);
  const proposal = proposeWrite({ path: "reports/check.md", content: "# 修复报告" }, 1, "tool-1");
  const first = await ws.writeApproved(proposal);
  assert.equal(first.unchanged, false);
  assert.equal((await ws.read("reports/check.md")).content, "# 修复报告");
  assert.equal((await ws.writeApproved(proposal)).unchanged, true);
  assert.equal((await readFile(join(dir, "reports", "check.md"), "utf8")), "# 修复报告");
  const replace = proposeWrite({ path: "reports/check.md", content: "# 新文件" }, 1, "tool-2");
  await assert.rejects(ws.writeApproved(replace), /未授权覆盖/);
  replace.overwrite = true;
  await ws.writeApproved(replace);
  assert.equal((await ws.read(replace.name)).content, "# 新文件");
}));
test("路径含符号链接时即使目录或文件在工作区内也拒绝访问", async () => fixture(async dir => {
  const ws = new FileWorkspace(dir);
  const external = await mkdtemp(join(tmpdir(), "durable-other-"));
  try {
    await writeFile(join(external, "external.md"), "不允许");
    await symlink(external, join(dir, "alias"));
    await symlink(join(external, "external.md"), join(dir, "alias-file.md"));
    await assert.rejects(ws.read("alias/external.md"), /重定向/);
    await assert.rejects(ws.read("alias-file.md"), /特殊文件/);
    await assert.rejects(ws.writeApproved(proposeWrite({ path: "alias/changed.md", content: "不能写入" }, null, null)), /重定向/);
    assert.deepEqual(await ws.list(), []);
  } finally { await rm(external, { recursive: true, force: true }); }
}));
test("内容大小受限；审批提议哈希被修改时不能写入", async () => fixture(async dir => {
  const ws = new FileWorkspace(dir);
  assert.throws(() => proposeWrite({ path: "too-big.md", content: "x".repeat(128 * 1024 + 1) }, 1, 1), /过大/);
  const p = proposeWrite({ path: "normal.md", content: "A" }, 1, 1);
  p.content = "B";
  await assert.rejects(ws.writeApproved(p), /校验失败/);
}));
