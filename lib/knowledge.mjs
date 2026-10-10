// v4 FR-01：只读本地 Obsidian 检索。默认仅公开内容类目录给 Agent / 微信。
import { constants } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const DEFAULT_PATHS = [
  "My-VPS/我的VPS/AI学习",
  "My-VPS/我的VPS/X灵感",
  "My-VPS/我的VPS/VPS小白教程",
];
const MAX_FILES = 600;
const MAX_FILE_BYTES = 180_000;
const MAX_RESULT_CHARS = 6200;
const REFRESH_MS = 30_000;
const SENSITIVE = new Set(["金融", "服务器管理", "个人档案", "财务记录", ".agents", "归档区", "短视频"]);
const clean = (s) => String(s ?? "").normalize("NFKC").toLowerCase();
const classify = (s) => {
  const value = clean(s);
  if (/^(?:archive|archived|deprecated|frozen)|归档|冻结|停用|废弃/.test(value)) return "archive";
  if (/草稿|draft|pending|待确认/.test(value)) return "draft";
  if (/active|现行|已发布/.test(value)) return "active";
  return "unknown";
};
const inside = (parent, child) => child === parent || child.startsWith(parent + sep);

function segments(path) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes("\0") || isAbsolute(path)) {
    throw new Error("无效的知识库路径");
  }
  const parts = path.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith(".") || p.includes(":"))) {
    throw new Error("无效的知识库路径");
  }
  return parts;
}
function allowedPrefix(path) {
  const p = segments(path);
  if (p.length < 3 || p[0] !== "My-VPS" || p[1] !== "我的VPS" || p.some((s) => SENSITIVE.has(s))) {
    throw new Error("目录不允许加入知识库查询白名单");
  }
  return p.join("/");
}
export function parseAllowedPaths(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return [...DEFAULT_PATHS];
  const unique = [...new Set(String(raw).split(";").map((x) => x.trim()).filter(Boolean).map(allowedPrefix))];
  if (!unique.length || unique.length > 12) throw new Error("知识库白名单目录数量无效");
  return unique;
}
function tokensOf(query) {
  const q = clean(query).replace(/(?:帮我|请问|查一下|找一下|以前|目前|现在|有没有|哪些|什么|怎么|关于|相关|内容|文章|一下|我的|你能|请|我想|是否|的)/gu, " ");
  const out = new Set();
  for (const part of q.match(/[a-z0-9][a-z0-9_.+-]*|[\p{Script=Han}]+/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(part)) {
      if (part.length === 1) continue;
      if (part.length <= 4) out.add(part);
      for (let i = 0; i + 2 <= part.length; i++) out.add(part.slice(i, i + 2));
      for (let i = 0; i + 3 <= part.length; i++) out.add(part.slice(i, i + 3));
    } else {
      if (part.length >= 2 || part === "x") out.add(part);
    }
  }
  return [...out].slice(0, 28);
}
function scoreString(hay, ts) {
  const h = clean(hay);
  return ts.reduce((n, t) => n + (h.includes(t) ? t.length >= 3 ? 2 : 1 : 0), 0);
}
function statusOf(filePath, contents) {
  if (/(?:^|\/)(归档|历史复盘|archive|archives|clippings)(?:\/|$)/i.test(filePath)) return "archive";
  const boundary = contents.startsWith("---\n") ? contents.indexOf("\n---\n", 4) : -1;
  const header = boundary >= 0 ? contents.slice(4, boundary) : "";
  const m = header.match(/^status:\s*(.+)$/im);
  return m ? classify(m[1].replace(/["']/g, "").trim()) : "unknown";
}
function buildLink(base, path, line) {
  if (!base) return null;
  const url = base.replace(/\/$/, "") + "/" + path.split("/").map(encodeURIComponent).join("/") + "#L" + line;
  return /^https:\/\//i.test(url) ? url : null;
}
function bestExcerpt(lines, ts) {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(lines.length, 1300); i++) {
    const line = lines[i].trim();
    if (!line || line === "---" || line.startsWith("![")) continue;
    const score = scoreString(line, ts) + (line.startsWith("# ") ? 2 : 0);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best < 0) best = lines.findIndex((x) => x.startsWith("# "));
  if (best < 0) best = 0;
  return { line: best + 1, excerpt: lines.slice(best, best + 3).join(" ").replace(/\s+/g, " ").slice(0, 340) };
}

// 只接受显式配置的本地目录；不主动 clone，不持有 GitHub token，不扫描全库敏感区。
export class ObsidianKnowledge {
  constructor({ root = "", allowedPaths, sourceURL = "", refreshMs = REFRESH_MS } = {}) {
    this.root = root;
    this.allowedPaths = parseAllowedPaths(allowedPaths);
    this.sourceURL = sourceURL;
    this.refreshMs = refreshMs;
    this.cached = [];
    this.baseReal = null;
    this.lastRefresh = 0;
    this.refreshing = null;
    this.fileCache = new Map();
  }
  get enabled() { return typeof this.root === "string" && this.root.trim().length > 0; }
  match(path) {
    const parts = segments(path);
    const canonical = parts.join("/");
    if (!this.allowedPaths.some((p) => canonical.startsWith(p + "/"))) {
      throw new Error("知识库路径不在授权范围");
    }
    if (parts.some((x) => SENSITIVE.has(x))) throw new Error("禁止访问敏感目录");
    return canonical;
  }
  async rootReal() {
    if (!this.enabled) throw new Error("知识库未启用：请先配置 OBSIDIAN_ROOT");
    if (!this.baseReal) {
      const full = await realpath(resolve(this.root));
      if (!(await stat(full)).isDirectory()) throw new Error("OBSIDIAN_ROOT 不是目录");
      this.baseReal = full;
    }
    return this.baseReal;
  }
  async resolveFile(path) {
    const name = this.match(path);
    const base = await this.rootReal();
    const file = join(base, ...name.split("/"));
    // 拒绝沿途符号链接，也拒绝最终文件为符号链接。不能只检查拼接的字符串。
    const actual = await realpath(file);
    if (!inside(base, actual)) throw new Error("知识库文件超出根目录");
    const expected = join(base, ...name.split("/"));
    if (actual !== expected) throw new Error("知识库不允许符号链接");
    return { name, actual };
  }
  async loadFile(path) {
    const { name, actual } = await this.resolveFile(path);
    if (!name.endsWith(".md") || /(?:^|\/)(?:AGENTS\.md)$/.test(name)) throw new Error("只读开放范围内的 Markdown 正文");
    const info = await stat(actual);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("文件过大或不是普通文件");
    const stamp = String(info.mtimeMs) + ":" + info.size;
    const cached = this.fileCache.get(name);
    if (cached?.stamp === stamp) return cached;
    const handle = await open(actual, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let contents;
    try {
      const fresh = await handle.stat();
      if (!fresh.isFile() || fresh.size > MAX_FILE_BYTES) throw new Error("文件过大或不是普通文件");
      contents = await handle.readFile({ encoding: "utf8" });
    } finally { await handle.close(); }
    const lines = contents.split(/\r?\n/);
    const entry = { path: name, stamp, lines, status: statusOf(name, contents),
      heading: lines.filter((x) => /^#{1,3} /.test(x)).slice(0, 35).join(" ").slice(0, 2500),
      title: name.split("/").at(-1).replace(/\.md$/, ""),
      searchText: contents.slice(0, MAX_FILE_BYTES) };
    this.fileCache.set(name, entry);
    return entry;
  }
  async refresh() {
    if (!this.enabled) return [];
    if (this.lastRefresh && Date.now() - this.lastRefresh < this.refreshMs) return this.cached;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.buildIndex();
    try { return await this.refreshing; } finally { this.refreshing = null; }
  }
  async buildIndex() {
    const base = await this.rootReal();
    const discovered = new Set();
    for (const prefix of this.allowedPaths) {
      const dir = join(base, ...prefix.split("/"));
      let rootDir;
      try { rootDir = await realpath(dir); } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (rootDir !== dir || !inside(base, rootDir)) throw new Error("知识库授权目录包含符号链接");
      const pending = [{ absolute: rootDir, prefix }];
      while (pending.length) {
        const { absolute, prefix: rel } = pending.pop();
        const items = await readdir(absolute, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith(".") || SENSITIVE.has(item.name) || item.isSymbolicLink()) continue;
          const path = rel + "/" + item.name;
          if (item.isDirectory()) {
            pending.push({ absolute: join(absolute, item.name), prefix: path });
          } else if (item.isFile() && item.name.endsWith(".md") && item.name !== "AGENTS.md") {
            discovered.add(path);
            if (discovered.size > MAX_FILES) throw new Error("知识库查询文件过多；请缩小白名单");
          }
        }
      }
    }
    const paths = [...discovered].sort();
    const results = [];
    for (const name of paths) {
      try { results.push(await this.loadFile(name)); }
      catch (error) {
        // 已被删除的文件可跳过；对权限/路径策略违规必须失败，不能悄悄放宽范围。
        if (error.code !== "ENOENT" && !/文件过大/.test(error.message)) throw error;
      }
    }
    for (const old of this.fileCache.keys()) if (!discovered.has(old)) this.fileCache.delete(old);
    this.cached = results;
    this.lastRefresh = Date.now();
    return results;
  }
  async search(query, { limit = 5, includeHistorical = false } = {}) {
    if (!this.enabled) return { enabled: false, reason: "未配置 OBSIDIAN_ROOT", hits: [] };
    if (typeof query !== "string" || !query.trim() || query.length > 160) throw new Error("查询词必须为 1～160 字");
    const ts = tokensOf(query);
    if (!ts.length) return { enabled: true, totalFiles: (await this.refresh()).length, hits: [], note: "请提供具体主题词" };
    const items = await this.refresh();
    const scored = items.filter((entry) => includeHistorical || entry.status !== "archive").map((entry) => {
      const pathScore = scoreString(entry.path, ts) * 8 + scoreString(entry.title, ts) * 9;
      const headingScore = scoreString(entry.heading, ts) * 3;
      const bodyScore = scoreString(entry.searchText, ts);
      return { entry, score: pathScore + headingScore + bodyScore };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
      .slice(0, Math.max(1, Math.min(6, Number(limit) || 5)));
    const hits = scored.map(({ entry }) => {
      const { line, excerpt } = bestExcerpt(entry.lines, ts);
      return { path: entry.path, title: entry.title, status: entry.status,
        sourceVersion: entry.stamp, line, excerpt,
        source: buildLink(this.sourceURL, entry.path, line) };
    });
    return { enabled: true, totalFiles: items.length, hits, note: hits.length ? "检索命中不代表内容是当前事实；按源文件状态与日期判断。" : "授权目录内未找到匹配内容；不代表其他目录或线上不存在。" };
  }
  async read(path, { startLine = 1, maxLines = 36 } = {}) {
    if (!this.enabled) throw new Error("知识库未启用：请先配置 OBSIDIAN_ROOT");
    const entry = await this.loadFile(path);
    const from = Number(startLine);
    if (!Number.isInteger(from) || from < 1 || from > entry.lines.length) throw new Error("行号超出范围");
    const count = Math.max(1, Math.min(50, Number(maxLines) || 36));
    const picked = entry.lines.slice(from - 1, from - 1 + count);
    let text = picked.map((line, i) => "L" + (from + i) + ": " + line).join("\n").slice(0, MAX_RESULT_CHARS);
    const end = Math.min(entry.lines.length, from + picked.length - 1);
    const link = buildLink(this.sourceURL, entry.path, from);
    return { path: entry.path, status: entry.status, sourceVersion: entry.stamp,
      startLine: from, endLine: end, totalLines: entry.lines.length,
      source: link, text, truncated: end < entry.lines.length || text.length >= MAX_RESULT_CHARS };
  }
  async status() {
    if (!this.enabled) return { enabled: false, allowedPaths: this.allowedPaths };
    const indexed = await this.refresh();
    return { enabled: true, files: indexed.length, allowedPaths: this.allowedPaths,
      lastRefresh: new Date(this.lastRefresh).toISOString(), readOnly: true };
  }
}
