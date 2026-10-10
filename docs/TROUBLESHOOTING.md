# 故障排查

适用于 **当前主分支 `main`**。请先运行 `npm run check`、`npm test`；如果是 Docker 部署，优先查看 `docker compose ps` 与**已脱敏**日志：

```bash
docker compose ps
docker compose logs --tail=100 pi-durable-assistant
```

提交 Issue 前，请去掉 API Key、Webhook 签名、Cookie、微信 ID、手机号、业务文本和其他敏感数据。

| 现象 | 常见原因 | 最小排查动作 |
| --- | --- | --- |
| `npm ci` 失败 | Node 版本过旧、依赖源不可访问 | `node -v`（至少 22.13）、核对 npm 网络及锁文件 |
| 本地没有启动 | 端口占用，或真实模型变量不完整 | 先试 `LLM_API=faux npm run dev`；必要时指定 `PORT=3001` |
| `Missing LLM_BASE_URL` 或模型参数错误 | `.env` 未正确加载；faux 与真实模型混淆 | 检查 `LLM_API` 类型和 `LLM_MODEL`、`LLM_BASE_URL`；本地用 `set -a; . ./.env; set +a` |
| 生产启动失败或 HTTP 401 | `DEMO_PASSWORD` 缺失、错误，或反向代理未传 `Authorization` | 填强密码、用 `curl -u demo` 检查，保留代理鉴权请求头 |
| 浏览器打不开 Docker 端口 | 默认仅绑定 VPS 的 `127.0.0.1:3300` | 在 VPS 本机测试；远程用 HTTPS 反向代理，不要把 3300 直接暴露公网 |
| 页面显示「与服务器断开」 | SSE 连接重建、代理/CDN 超时、容器重启 | 看服务日志与反向代理 SSE 超时/缓冲设置；短暂重连不代表任务丢失 |
| 点击「模拟崩溃」返回 403 | 生产模式默认关闭调试入口 | 正常安全行为；只在隔离演示环境临时开启 `ENABLE_CRASH_DEMO=1` |
| 任务显示运行中很久 | API 慢、子 Agent 还没完成、上游服务卡住 | 打开任务中心查看子会话/任务状态，结合日志排查，不要直接删除 SQLite |
| 计划每天发生时间偏移 | 当前是固定分钟间隔，不是时区 Cron | `1440` 表示每隔 24 小时；夏令时变化会影响本地钟点 |
| 网页关闭后收不到提醒 | `NOTIFY_WEBHOOK_URL` 未配置；默认 `NOTIFY_MODE=errors` | 如需正常提醒也推送，改为 `all` 并测试真实接收端 |
| 飞书/Webhook 收不到消息 | URL、机器人权限、限流、网络；当前是尽力发送 | 先验证 Webhook 目标；主分支暂无通用持久重试，别误当“保证送达” |
| 上传失败、提示类型不支持 | 超过 5 个文件、5MiB 图片、200KiB 文本、10MiB 总额，或不支持的格式 | 缩小文件；使用 PNG/JPEG/WebP/GIF 和 UTF-8 文本类文件 |
| 网页图片上传成功但模型看不到图 | 模型 API 不支持图像，或 `LLM_API=faux` | 选择确实支持多模态的服务商/模型；并核对协议兼容性 |
| 微信收不到回复 | 未扫码/失效、`WECHAT_ENABLED` 未启用、发送 token 不匹配 | 按 [微信手册](WECHAT.md) 检查 `wx-bot` 状态、允许的发送方和本地接口 |
| 微信显示 `-14` | iLink 登录过期 | 按 [微信手册](WECHAT.md) 重新 `login primary` |
| 微信显示 `no context_token` | 没有可用于回复的上下文令牌 | 先从微信主动给 ClawBot 发一条消息；旧阻断消息不自动补发 |
| 更新后会话不见了 | 使用了不同的 Compose project/数据卷，或误执行 `down -v` | **暂停写入**，检查卷，不要用新数据覆盖旧数据；从已验证备份恢复 |

## 常用自检命令

本地（不访问真实模型）：

```bash
node --version
npm ci
npm run check
npm test
LLM_API=faux npm run dev
```

Docker：

```bash
docker compose config --quiet
docker compose ps
docker compose logs --tail=100 pi-durable-assistant
```

微信（已启用时）：

```bash
docker compose --profile wechat ps
docker compose --profile wechat logs --tail=100 wx-bot
```

## 提 Issue 时提供什么

请使用模板说明：当前 `main` 或 PR 分支、操作系统、Node 与 Docker 版本、预期行为、实际行为、最短复现步骤、`npm run check` 与 `npm test` 结果、脱敏日志。不要直接公开 `.env`、Docker 数据卷、聊天历史、JWT、微信 token 或任何 API 密钥。

## 需要知道的边界

`main` 不含 [Obsidian 检索 PR #4](https://github.com/xiaomoBoy/pi-durable-assistant/pull/4)、[文件审批 PR #5](https://github.com/xiaomoBoy/pi-durable-assistant/pull/5) 或 [持久通用通知 PR #6](https://github.com/xiaomoBoy/pi-durable-assistant/pull/6)。如果你运行的是功能分支，应参照对应 PR 文档，而非以本页断言所有能力都能在主分支启用。

[快速开始](GETTING_STARTED.md) · [配置参考](CONFIGURATION.md) · [部署与备份](DEPLOYMENT.md)
