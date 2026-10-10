# 微信 iLink 接入（Pi Durable + wx-bot）

> 状态：已编写通道、部署配置与模拟消息回归测试；尚未在真实微信/iLink 上扫码或进行生产 VPS 验收。

## 架构

本仓库管理两个独立容器：Node.js Pi Durable（网页、会话、Durable Runtime、任务）和 Go wx-bot（微信扫码、轮询、媒体协议）。两个容器使用 `network_mode: service:pi-durable-demo` 共用网络命名空间，仅通过 `127.0.0.1` 内部 HTTP 访问，**不对公网开放 wx-bot 的 18790 端口**。

`wx-bot` 来自 [lawrencewzen/wx-bot](https://github.com/lawrencewzen/wx-bot) 的固定提交 `57ed5f56eedce782e378483f762c7565c45ade5d`。Docker 构建时执行 `deploy/wechat/patch_upstream.py`，修复“先推进游标、后投递 Webhook”导致的漏消息，并参考 [腾讯官方协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md) 更新二维码为 POST。若上游变更导致补丁不匹配，构建会失败而非静默忽略。其余 iLink 协议细节仍由 wx-bot 维护。

## 1. 配置密钥

```bash
cp .env.example .env
# 同时填写原有 DEMO_PASSWORD、LLM_API_KEY / 模型参数
# 设置 WECHAT_ENABLED=1
# 以下命令生成两个不同的随机密钥，分别填入 WECHAT_WEBHOOK_KEY 与 WECHAT_SEND_TOKEN
openssl rand -hex 32
openssl rand -hex 32
```

两个令牌不同，也不能和网页登录密码共用。不要把 `.env` 上传到 Git。推荐保持默认 `WECHAT_SEND_URL=http://127.0.0.1:18790/v1/send`。

默认仅允许 **扫码绑定微信账号自己** 给 ClawBot 发送消息，配置位于 `deploy/wechat/config.json`。需要多个账号时，添加不同 binding（账号），并逐个登录。现阶段微信图片/文件/视频会告知 Agent “尚不能读取附件”，不会让模型假装已经看过文件；语音支持微信提供的转写文字。

## 2. 启动与扫码

```bash
# 首次构建双服务，必须有 Go 官方依赖源与 GitHub 出站网络
docker compose --profile wechat build
# 先启动主服务
docker compose up -d pi-durable-demo
# 前台扫码，最好在 SSH 终端或带二维码的交互终端执行
docker compose --profile wechat run --rm wx-bot --config /etc/wx-bot/config.json login primary
# 之后常驻启动
docker compose --profile wechat up -d
docker compose --profile wechat logs -f wx-bot
```

用扫码微信给 **ClawBot 会话** 发送一条文本。Pi Durable 会创建“微信：primary”会话并自动发回最终回答。网页与微信共用同一 Durable Runtime。扫码后 `bot_token`、消息游标、`context_token` 保存在 `wx-bot-state` Docker 持久卷；Agent SQLite 保存在 `pi-durable-demo-data`。切勿 `docker compose down -v`。

## 3. 查看状态与排障

```bash
docker compose --profile wechat exec wx-bot wx-bot --config /etc/wx-bot/config.json status
docker compose --profile wechat logs --tail=150 wx-bot
# 带 HTTP Basic Auth，可查看会话数与待发送数量
curl -u demo:<DEMO_PASSWORD> https://YOUR_DOMAIN/api/wechat/status
```

- 无微信绑定：确认 `WECHAT_ENABLED=1`、已扫码、消息来自被授权账号。
- `-14`：iLink 登录过期，重新运行上面的 `login primary`，然后重启 wx-bot。
- `no context_token`：先从微信给 ClawBot 发消息，之后再测试回复。被阻止发送的旧消息目前留在 Outbox，**不会自动解封补发**，避免未经确认的大量补推。
- 网络或 5xx：出站 Outbox 使用退避重试；进程重启后恢复。微信成功发送但 Pi Durable 尚未标记为 sent 就崩溃，可能重复发送，**不是端到端 exactly-once**。
- 腾讯服务端存在主动回复窗口、限流或策略变化，定时任务结果可能无法送达微信；不要将它作为唯一告警手段。
- Go Dockerfile 固定上游版本且运行单测；若构建报补丁不匹配，需要复核当前腾讯协议后升级版本，不能随意取消补丁。

## 4. 消息一致性与安全边界

入站流程：iLink 长轮询 → wx-bot 白名单 → Bearer token Webhook → Durable 会话（稳定 requestId 幂等）→ 模型运行 → 观察已提交的助手 Entry → session-scoped Document Outbox → 本机发送 API。收到 HTTP 2xx 才推进上游游标，失败会重投批次；重投由 Durable 去重。出站是 **至少一次** 投递语义。对话绑定、回复游标、待发消息与重试信息写在 SQLite 中；重启不会凭空失去待发消息。

不通过微信暴露任意命令执行入口。只有已有 Agent 工具能被调用；强制使用白名单，保护密钥、SQLite 与微信 session volume。生产环境必须使用 HTTPS + Basic Auth 保护网页。强烈建议先用测试微信账号验证 iLink 登录及稳定性，不承诺所有账号均能使用该服务。
