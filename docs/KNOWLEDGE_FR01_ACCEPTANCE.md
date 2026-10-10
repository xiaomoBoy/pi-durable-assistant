# FR-01 Obsidian 检索 — 部署、操作与验收

**状态**：代码在 `feat/v4-fr01-obsidian-readonly` 功能分支等待用户验收；此文是独立于真实微信账号的可复查操作步骤。

## 运行原理

Pi Durable 不知道你的 GitHub 私有仓库凭据，也不尝试登录云端 Obsidian。你需要在 VPS 宿主机上有一份**本人授权的、可读取的 Obsidian 仓库本地副本**。建议用只读 GitHub Deploy Key 获取，仓库管理和更新仍由你控制。不要把 token、私钥或带凭据的 URL 写入 .env/笔记或日志。

启用时通过 `compose.knowledge.yaml` 将这个 checkout 挂载到 Node 容器的 `/obsidian`，**挂载 read_only**；默认 `compose.yaml` 完全不挂载知识库。不会运行 `git pull`、`git push` 或修改源文件。

服务只按明确的路径白名单检索：
- `My-VPS/我的VPS/AI学习/`
- `My-VPS/我的VPS/X灵感/`
- `My-VPS/我的VPS/VPS小白教程/`

默认不读 `my-info/`（个人、财务和经营），不读 `agent-memory/`、`服务器管理/`、`资料库/`。即使微信接入成功也不能绕过这一限制。允许使用 `OBSIDIAN_ALLOWED_PATHS` 指定其他 `My-VPS/我的VPS/` **具体子目录**，但金融、短视频工程、归档区和隐藏目录依然拒绝。

## 部署

前提：已经在 VPS 上按 README 部署 Pi Durable。使用已有的 `.env`，补齐：

```dotenv
# 容器中的只读挂载路径
OBSIDIAN_ROOT=/obsidian
# 宿主机上私有 Obsidian checkout 的绝对路径（示例，根据实际修改）
OBSIDIAN_HOST_PATH=/srv/obsidian-readonly
# 非必需；用于在结果中生成 GitHub 原文件行号链接（私有仓库仅授权用户可点开）
OBSIDIAN_SOURCE_URL=https://github.com/xiaomoBoy/Obsidian/blob/main
# 不填则使用以上三个默认目录
OBSIDIAN_ALLOWED_PATHS=
```

宿主机目录必须已存在且能被容器里的非 root `node` 用户读取。**不要**为了省事把整个文件系统或家目录挂进容器。仓库的 `.git` 即使存在也不会被搜索；不要将 GitHub Deploy Key 放进挂载目录。

```bash
git -C /path/to/pi-durable-demo pull --ff-only
docker compose -f compose.yaml -f compose.knowledge.yaml build pi-durable-demo
docker compose -f compose.yaml -f compose.knowledge.yaml up -d
```

如果也启用微信，叠加已有 `--profile wechat`：
```bash
docker compose -f compose.yaml -f compose.knowledge.yaml --profile wechat up -d
```

变更 Obsidian 文件后，在宿主机按你已有的 Git 工作流更新 checkout；检索缓存最迟约 30 秒后刷新（下次有查询时）。如果使用非 Docker 模式，本地进程只需 `OBSIDIAN_ROOT=/path/to/Obsidian`，文件权限仍应只读。

## 4 项实际验收

先用后台 API 排除模型推理不稳定的影响。以下命令需要已配置 `DEMO_PASSWORD`：

```bash
curl -u demo:"$DEMO_PASSWORD" \
  "http://127.0.0.1:3300/api/knowledge/status"

curl -u demo:"$DEMO_PASSWORD" -G \
  --data-urlencode "q=X 写作习惯" \
  "http://127.0.0.1:3300/api/knowledge/search"

curl -u demo:"$DEMO_PASSWORD" -G \
  --data-urlencode "path=My-VPS/我的VPS/X灵感/写作参考.md" \
  --data-urlencode "line=1" \
  "http://127.0.0.1:3300/api/knowledge/read"

# 敏感目录必须返回 403
curl -i -u demo:"$DEMO_PASSWORD" -G \
  --data-urlencode "path=my-info/我的信息/财务记录/收支概览.md" \
  "http://127.0.0.1:3300/api/knowledge/read"
```

然后在**真实模型**网页或已完成扫码的微信 ClawBot 会话发消息：

- “在我的 Obsidian 查一下当前 X 写作习惯，并引用文件路径与行号。”
- “以前有哪些 Pi Durable 资料？有历史和现行状态要区分。”
- “给我看看个人财务 / 服务器资产原文。”→ 应拒绝或说明无权限；不会自动开放 `my-info` 等目录。
- 重启容器后重复问第一问，检查源文件未改变。

如果使用 `LLM_API=faux`，因为它是固定演示剧本，**不会主动调用检索工具**；API 与单测仍可检验确定性链路。真实 LLM 的工具调用及微信端实际体验需要你线上验收。

## 接口与内部能力

- Agent：`search_knowledge({query})` 和 `read_knowledge({path,startLine?})`，被网页和微信复用。
- REST：`GET /api/knowledge/status`、`GET /api/knowledge/search?q=&history=1`、`GET /api/knowledge/read?path=&line=`，全受原有 Basic Auth 保护。
- 只读：不创建长期记忆、不写 Obsidian、不自动对外发布。历史默认不参与现行检索；用户明确查历史可带 `history=1`。
- 结果：源文件相对路径、状态 `active / draft / archive / unknown`、源文件 mtime/大小标识、行号及小段原文；如果配置了 SOURCE_URL 则带对应 GitHub 链接。
- 性能保护：最多 600 Markdown 文件、单文件 180KB、检索最多 6 个候选；单次精读最多 50 行、约 6200 字符。
- 局限：目前是本地关键词与标题/内容加权检索，**不是语义向量搜索**；不保证所有语义表达都能命中。未知文档状态不是“已验证当前有效”。暂不支持图片/PDF 附件理解，也不允许模型通过该工具扩大白名单。
