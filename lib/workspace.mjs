// 单用户 Agent 的文件工作区：路径受限、拒绝符号链接和隐藏文件。
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, realpath, readdir, rename, rm, lstat, stat } from "node:fs/promises";
import { resolve, join, dirname, sep } from "node:path";

export const MAX_FILE_BYTES = 128 * 1024;
const allowedExtensions = new Set(["md", "txt", "json", "csv"]);
const digest = data => createHash("sha256").update(data).digest("hex");

export function validateName(name) {
  if (typeof name !== "string" || name.length < 5 || name.length > 220 ||
      name.startsWith("/") || name.includes("\\") || name.includes("\0")) throw Error("非法工作区路径");
  const parts = name.split("/");
  if (parts.length > 7 || parts.some(x => !x || x.startsWith(".") || x.includes(":") || x === "..")) throw Error("非法工作区路径");
  if (!allowedExtensions.has(parts.at(-1).split(".").at(-1).toLowerCase())) throw Error("不支持该文件类型");
  return name;
}
export class FileWorkspace {
  constructor(root = "") { this.root = root; this.base = null; }
  get enabled() { return !!this.root; }
  async basePath() {
    if (!this.enabled) throw Error("工作区未启用");
    if (!this.base) {
      const resolved = await realpath(resolve(this.root));
      if (!(await stat(resolved)).isDirectory()) throw Error("工作区目录不存在");
      this.base = resolved;
    }
    return this.base;
  }
  async filePath(name, makeParents = false) {
    const parts = validateName(name).split("/");
    const base = await this.basePath();
    let cursor = base;
    for (const part of parts.slice(0, -1)) {
      cursor = join(cursor, part);
      try { if (makeParents) await mkdir(cursor); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      const details = await lstat(cursor);
      if (!details.isDirectory() || details.isSymbolicLink() || (await realpath(cursor)) !== cursor) throw Error("拒绝路径重定向");
    }
    const file = join(cursor, parts.at(-1));
    if (!file.startsWith(base + sep)) throw Error("越过工作区边界");
    try {
      const entry = await lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink() || (await realpath(file)) !== file) throw Error("拒绝特殊文件");
      return { file, exists: true };
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    return { file, exists: false };
  }
  async read(name) {
    const { file, exists } = await this.filePath(name);
    if (!exists) throw Error("文件不存在");
    const descriptor = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const metadata = await descriptor.stat();
      if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) throw Error("文件超过大小限制");
      const content = await descriptor.readFile("utf8");
      return { name, content, bytes: Buffer.byteLength(content), sha256: digest(content) };
    } finally { await descriptor.close(); }
  }
  async list() {
    const base = await this.basePath();
    const result = [];
    async function walk(directory, prefix) {
      if (result.length > 400) throw Error("文件过多");
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
        const name = prefix ? prefix + "/" + item.name : item.name;
        if (item.isDirectory()) { await walk(join(directory, item.name), name); continue; }
        if (!item.isFile()) continue;
        try { validateName(name); result.push(name); } catch {}
      }
    }
    await walk(base, "");
    return result;
  }
  async writeApproved({ name, content, hash, overwrite }) {
    validateName(name);
    if (typeof content !== "string" || !content || Buffer.byteLength(content) > MAX_FILE_BYTES ||
        hash !== digest(content)) throw Error("审批内容校验失败");
    const { file, exists } = await this.filePath(name, true);
    if (exists) {
      const current = await this.read(name);
      if (current.sha256 === hash) return { name, bytes: current.bytes, sha256: hash, unchanged: true };
      if (!overwrite) throw Error("文件存在，未授权覆盖");
    }
    const temporary = join(dirname(file), ".write-" + randomUUID());
    const descriptor = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { await descriptor.writeFile(content); await descriptor.sync(); }
    finally { await descriptor.close(); }
    try { await this.filePath(name); await rename(temporary, file); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
    return { name, bytes: Buffer.byteLength(content), sha256: hash, unchanged: false };
  }
}
export function proposeWrite({ path, content, overwrite = false }, conversationId, callId) {
  const name = validateName(path);
  if (typeof content !== "string" || !content || Buffer.byteLength(content) > MAX_FILE_BYTES) throw Error("内容无效或过大");
  return { id: randomUUID(), name, content, hash: digest(content), overwrite: overwrite === true,
    conversationId, callId, state: "pending", createdAt: Date.now(), updatedAt: Date.now(), attempts: 0, error: null };
}
export function stripContent(proposal) {
  const { content, ...rest } = proposal;
  return { ...rest, bytes: Buffer.byteLength(content || "") };
}
