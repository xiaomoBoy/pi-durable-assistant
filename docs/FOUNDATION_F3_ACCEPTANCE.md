# F3｜可靠通知 Outbox：部署与验收

**交付范围：**通用 Webhook 和飞书文本机器人投递。微信 iLink 继续使用原有独立 Outbox（本阶段不修改微信协议）。运行仍基于单用户 Pi Durable 1.1.0、SQLite、原生 ESM。

## 解决了什么

此前任务完成后先提交状态，再向外发送 Webhook；网络故障或进程崩溃可能直接丢失消息。

现在任务完成时，把通知与**任务完成状态在同一次 Durable 事务中提交**，独立 worker 发送。通知包含稳定的 `id`：

- `schedule:<scheduleId>:<triggerTime>`
- `background:<jobId>`
- `reminder:<taskId>`

发送成功标记 `sent`；网络问题及 HTTP 429/5xx 等进入 `pending`，退避重试；HTTP 400/401/403/404/405/410/413/415/422 或超过 8 次尝试标记 `blocked`。任务中心可以查看并手动重试。进程在 `sending` 状态崩溃，则超过租约时间后重新发送。成功记录保留约 7 天、最多 300 条；未成功的记录不会因历史清理删除。

**投递保证：本地事件持久化 + 至少一次尝试，不保证第三方端到端 exactly-once。** 服务器收到消息后、标记 `sent` 前崩溃时仍可能重复发出。接收方应按 `X-Pi-Event-ID` 做幂等。飞书机器人不一定支持接收端幂等，因此更可能出现重复消息。

## 通知配置

在现有 `.env` 设置（不要提交实际 Webhook URL / Token）：

```dotenv
NOTIFY_WEBHOOK_URL=https://example.com/your-private-webhook
NOTIFY_WEBHOOK_KIND=generic
NOTIFY_MODE=errors
# 只有确实需要通过不加密的 HTTP 投递时才设置（默认 0）
NOTIFY_ALLOW_HTTP=0
```

- `NOTIFY_MODE=errors`：默认只推送**明确失败的后台子 Agent**；不推送成功、提醒和计划触发。
- `NOTIFY_MODE=all`：推送后台任务结果、计划触发和定时提醒。
- `NOTIFY_MODE=off` 或 URL 留空：不自动发送；已经持久排队的记录暂停并保留，**不会自动补齐关闭期间未生成的通知**。
- Webhook kind 支持 `generic`（`{id,type,text,failed,at}` JSON）与 `feishu`（文本机器人结构），发送时仍带 `X-Pi-Event-ID`。
- 对 `feishu`，**HTTP 200 不等于真正发送成功**；还检查 JSON 的 `code` 或 `StatusCode` 是否为 0。业务失败保留通知以供重试，避免错误标记 `sent`。
- 仅当明确设置 `NOTIFY_ALLOW_HTTP=1`（或本地 `NODE_ENV=test`）才允许 HTTP URL；强烈建议生产 HTTPS。
- 已排队事件记录原有 kind，重启后如切换了通知类型，旧事件会阻断而不是悄悄改成新格式发送，需检查再人工处理。
- 不会将含密钥的 Webhook URL 保存到 Durable 文档，不在发送失败日志输出它。

**升级时：**旧 v3 尝试发送但失败的通知没有留存记录，无法自动找回；升级后的新事件才受 Outbox 保障。

## 接口（现有 Basic Auth）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/notifications/status` | 配置状态、各投递状态数量；不含 Webhook URL |
| GET | `/api/notifications` | 最近 100 条投递记录、重试次数、失败类型 |
| POST | `/api/notifications/retry` | `{"id":"background:..."}`，只允许重试 `blocked`；受同源 POST 规则保护 |

任务中心新增「通知投递」区域，可直接查看各通知状态，针对 `blocked` 点击「手动重试」。没有接收端时不应该配置 `NOTIFY_MODE=all`，以免生成大量积压事件。

## 你只需验收 4 项

1. **正常发送**：配置正确的 Webhook URL；`NOTIFY_MODE=all`，创建后台子 Agent；任务完成后通知状态变成 `sent`，接收方收到相同的 `X-Pi-Event-ID`。
2. **失败恢复**：临时让自己的测试接收端返回 HTTP 503；确认消息处于 `pending`，有尝试计数；恢复接收端并重启 Agent，状态最终变为 `sent`。不要在正式飞书群机器人上故意制造故障。
3. **永久失败与手动重试**：测试端返回 HTTP 401/403，确认消息被标记 `blocked`，不会无限请求；修正接收端后从任务中心手动重试。
4. **权限和敏感信息**：未登录不得查看通知队列；状态列表不包含 Webhook 凭据；没有配置通知时原有提醒、后台任务正常完成。

无需真模型的自动测试：

```bash
npm ci
npm run check
npm test
```

CI 覆盖通知策略、事务内入队、重复事件抑制、回退、人工重试、租约恢复、服务重启和原有微信及任务回归。自动测试使用模拟 Webhook 与 faux 模型，不等同于已完成真实飞书机器人/VPS 上线测试。

## 已知边界

- 通知内容保存在本地 SQLite，含后台任务摘要；备份、数据库权限与宿主机敏感保护仍要按生产规范执行。
- 没有短信/邮箱/手机系统原生推送；仍通过已配置的 Webhook/飞书发送。
- 目前按全局配置管理通知，无多租户、不同会话独立开关；微信有自己的独立持久通道。
- 对外成功后进程崩溃可能造成重复投递，无法通过客户端独自消除，接收方需要按 ID 去重。
- F4 任务成果索引、F5 成本预算、F6 数据库灾难恢复仍待分别开发。
