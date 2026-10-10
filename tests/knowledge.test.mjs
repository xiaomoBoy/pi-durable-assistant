import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObsidianKnowledge, parseAllowedPaths } from "../lib/knowledge.mjs";

const X = "My-VPS/我的VPS/X灵感";
const AI = "My-VPS/我的VPS/AI学习";
const TARGET = X + "/写作参考.md";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-knowledge-"));
  for (const dir of [X, AI, "my-info/我的信息/副业经营", X + "/归档"])
    await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, TARGET), [
    "---", "status: 现行", "updated: 2026-10-10", "---",
    "# X 写作参考", "## 本人确认的 X 写作习惯",
    "Pi 相关介绍一般分点，开头需要钩子。", "不是所有技术问题都套用推文风格。",
  ].join("\n"));
  await writeFile(join(root, X, "归档", "旧写法.md"),
    "---\nstatus: 归档\n---\n# 旧版写作习惯\n旧的短帖规则，请勿作为当前事实。");
  await writeFile(join(root, AI, "Pi Durable 介绍.md"),
    "# Pi Durable\nPi Durable 让后台任务可以断点恢复。");
  await writeFile(join(root, "my-info/我的信息/副业经营/副业战略.md"),
    "# 副业战略\n高度敏感的个人经营数据，不该检索。");
  await writeFile(join(root, X, "AGENTS.md"), "# 内部目录规则");
  return root;
}

test("默认只允许内容目录，拒绝扩权至个人/财务/根目录", () => {
  const paths = parseAllowedPaths();
  assert.equal(paths.length, 3);
  assert.throws(() => parseAllowedPaths("my-info/我的信息"), /不允许/);
  assert.throws(() => parseAllowedPaths("My-VPS/我的VPS"), /不允许/);
  assert.throws(() => parseAllowedPaths("My-VPS/我的VPS/金融"), /不允许/);
  assert.throws(() => parseAllowedPaths("My-VPS/我的VPS/AI学习;服务器管理"), /不允许/);
});
test("知识库默认未启用，不会退化为访问未授权的私有仓库", async () => {
  const k = new ObsidianKnowledge();
  assert.equal((await k.search("Pi Durable")).enabled, false);
  assert.equal((await k.status()).enabled, false);
  await assert.rejects(k.read(TARGET), /未启用/);
});
test("检索现行 X 写作规则，附来源路径与精确行号，排除敏感资料", async () => {
  const root = await fixture();
  try {
    const k = new ObsidianKnowledge({ root, sourceURL: "https://github.com/example/private/blob/main" });
    const result = await k.search("X 写作习惯");
    assert.equal(result.enabled, true);
    assert.ok(result.totalFiles >= 3);
    const selected = result.hits.find((h) => h.path === TARGET);
    assert.ok(selected, JSON.stringify(result.hits));
    assert.equal(selected.status, "active");
    assert.match(selected.source, /%E5%86%99%E4%BD%9C%E5%8F%82%E8%80%83\.md#L\d+/);
    assert.ok(selected.line > 0);
    assert.ok(result.hits.every((h) => !h.path.includes("my-info")));
    const detailed = await k.read(TARGET, { startLine: 6, maxLines: 2 });
    assert.match(detailed.text, /本人确认/);
    assert.equal(detailed.startLine, 6);
    assert.equal(detailed.endLine, 7);
    assert.equal(detailed.status, "active");
    assert.match(detailed.source, /#L6$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("归档默认不参与当前结果，但显式查历史可以展示且标记为归档", async () => {
  const root = await fixture();
  try {
    const k = new ObsidianKnowledge({ root });
    const current = await k.search("旧版写作习惯");
    assert.equal(current.hits.some((x) => x.status === "archive"), false);
    const history = await k.search("旧版写作习惯", { includeHistorical: true });
    assert.equal(history.hits.some((x) => x.status === "archive"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("绝不读取父目录、AGENTS、符号链接和黑名单路径", async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "pi-secret-"));
  try {
    await writeFile(join(outside, "secrets.md"), "绝密");
    await symlink(join(outside, "secrets.md"), join(root, X, "link.md"));
    const k = new ObsidianKnowledge({ root });
    for (const path of ["../../my-info/我的信息/副业经营/副业战略.md",
      "my-info/我的信息/副业经营/副业战略.md", X + "/AGENTS.md",
      X + "/link.md", X + "/../AI学习/Pi Durable 介绍.md"])
      await assert.rejects(k.read(path), /授权|无效|Markdown|符号链接|超出/);
    const result = await k.search("绝密");
    assert.equal(result.hits.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
test("本地文件变化后可刷新，无需 SQLite 或全库复制", async () => {
  const root = await fixture();
  try {
    const k = new ObsidianKnowledge({ root, refreshMs: 0 });
    await k.search("Pi Durable");
    const path = join(root, AI, "Pi Durable 介绍.md");
    await writeFile(path, "# Pi Durable\n最新实测：恢复执行成功（已独立验证）。");
    const again = await k.search("最新实测");
    assert.ok(again.hits.some((x) => x.path.endsWith("Pi Durable 介绍.md")));
    assert.match((await readFile(path, "utf8")), /最新实测/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
