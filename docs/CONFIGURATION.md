# 配置参考（当前 main）

本页基于 `.env.example`、`lib/agent.mjs`、`lib/v3.mjs`、`lib/wechat.mjs` 和 `compose.yaml` 的**当前主分支实现**。请先按 [快速开始](GETTING_STARTED.md) 使用 `faux` 确认项目可正常启动，再填写真实凭据。

## 环境变量

| 变量 | 默认 / 示例 | 说明 |
| --- | --- | --- |
| `LLM_API` | `openai-completions` | 可选 `openai-completions` / `openai-responses` / `anthropic-messages` / `faux` |
| `LLM_BASE_URL` | 空 | 实际服务商提供的 API 基础地址；faux 不需要 |
| `LLM_API_KEY` | 空 | 实际 API Key，不提交到 Git |
| `LLM_MODEL` | 空 | 模型 ID，须与 API 类型及服务商匹配 |
| `LLM_CONTEXT_WINDOW` | `128000` | 提供给模型目录的上下文窗口配置，并非真实配额保证 |
| `LLM_MAX_TOKENS` | `8192` | 模型目录的最大输出 token 配置 |
| `DEMO_PASSWORD` | 空 | HTTP Basic Auth 密码；生产模式必须配置，用户名固定 `demo` |
| `HOST_PORT` | `3300` | Docker 映射到宿主机 `127.0.0.1` 的端口 |
| `NOTIFY_WEBHOOK_URL` | 空 | 通用 Webhook 或飞书机器人的完整 URL，含签名时视为敏感凭据 |
| `NOTIFY_WEBHOOK_KIND` | `generic` | `generic` JSON / `feishu` 文本机器人 |
| `NOTIFY_MODE` | `errors` | `errors`：仅明确失败的后台任务；`all`：也发成功/提醒/计划触发；`off`：不发送 |
| `ENABLE_CRASH_DEMO` | `0` | 生产模式是否开放 `POST /api/crash`；正式服务应保持 `0` |
| `WECHAT_ENABLED` | `0` | 是否启用微信入站转发；需同时启动 `wx-bot` profile |
| `WECHAT_WEBHOOK_KEY` | 空 | 微信桥到 Node 的入站 Bearer token |
| `WECHAT_SEND_TOKEN` | 空 | Node 到微信桥本地发送接口的令牌，必须与入站令牌不同 |
| `WECHAT_SEND_URL` | `http://127.0.0.1:18790/v1/send` | 共用网络命名空间内的微信发送地址，通常不要更改 |

另外，`PORT`（本地默认 `3000`）和 `DATA_DIR`（本地默认 `./data`、Docker 默认 `/data`）在代码中读取，可用于开发或容器环境；它们不是当前示例 `.env.example` 的主要部署配置。

### 最小可运行配置

**无模型的本地演示：**

```bash
LLM_API=faux npm run dev
```

**接实际模型：**

```dotenv
LLM_API=openai-completions
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=YOUR_OWN_KEY
LLM_MODEL=your-model-id
```

请用真实供应商参数替换占位符。该项目通过显式提供 `baseUrl` 和 API 协议类型接入模型，**不能保证所有 OpenAI 兼容中转都支持图像、工具或相同的模型字段**。供应商不支持的能力不要默认当作项目已支持。

### 生产部署最低配置

```dotenv
DEMO_PASSWORD=REPLACE_WITH_A_STRONG_RANDOM_PASSWORD
LLM_API=openai-completions
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=YOUR_OWN_KEY
LLM_MODEL=your-model-id
ENABLE_CRASH_DEMO=0
```

使用 `docker compose up -d --build`。生产未配置 `DEMO_PASSWORD` 会拒绝启动，不能通过移除鉴权来解决。默认容器映射只绑定到 `127.0.0.1`，需要远程访问时应另外部署 TLS 反向代理。

## 运行模式与可选通道

**通知：**不配置 `NOTIFY_WEBHOOK_URL` 时后台任务照常进行，只是不会主动向手机或飞书群发送事件。主分支的 Webhook / 飞书仍是尽力发送：**没有持久通用 Outbox**；出错可能丢失消息。带幂等重试的改造仍在 [PR #6](https://github.com/xiaomoBoy/pi-durable-assistant/pull/6)，不要把未合并功能当作当前能力。Webhook 对端应按 `X-Pi-Event-ID` 去重。

**微信：**默认不开启。启用前分别用 `openssl rand -hex 32` 生成 `WECHAT_WEBHOOK_KEY` 与 `WECHAT_SEND_TOKEN`，将 `WECHAT_ENABLED=1` 放入 `.env`，按 [微信接入手册](WECHAT.md) 使用 `--profile wechat` 启动。微信扫码凭据保存在专用 Docker 命名卷，不应导出到仓库。

**工作区审批与 Obsidian：**这两项在待验收的 [PR #5](https://github.com/xiaomoBoy/pi-durable-assistant/pull/5)、[PR #4](https://github.com/xiaomoBoy/pi-durable-assistant/pull/4) 中，当前 `main` 的 `.env.example` **没有**它们的配置。请勿按待合并分支的参数尝试启用主分支。

## 安全建议

- 不提交 `.env`、服务商 Key、微信数据卷备份和包含鉴权信息的日志。
- 项目是单用户原型，不提供多租户隔离、SSO 或多用户权限矩阵；尽量只通过自己控制的 HTTPS 入口访问。
- 模型费用可能产生在供应商/中转平台；**项目内 `cost: 0` 占位不等于免费**，建议在上游平台设置预算和额度限制。
- 只下载/接入信任的模型或服务地址；不要把私有文件附件发送给不信任的模型提供商。
- 对持久化 SQLite 和微信状态卷进行一致性备份；参考 [部署手册](DEPLOYMENT.md)。

[返回 README](../README.md) · [故障排查](TROUBLESHOOTING.md)
