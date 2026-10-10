# Pi Durable Edge v0.2：模型配置与基础聊天

状态：开发分支 `feat/edge-model-chat-v02`，**待 Cloudflare 真实环境验收**。这是长期维护项目的功能迭代，不是临时 Demo。

## UI 策略：复用原版 Pi Durable Assistant（本分支已实现）

- **沿用原项目的实际页面资产**：`public/style.css` 完整复制到 `cloudflare/public/style.css`，左侧会话栏、中间聊天流和输入框、右侧小 D 吉祥物、任务/提醒卡片的 class 结构与响应式样式来自原项目。
- **保留小 D 原始 SVG 和状态样式**：`cloudflare/public/mascot.js` 是从原版 `public/app.js` 提取的视觉素材；运行中/空闲时更新状态。
- **不复制原版 83 KB 的旧 JavaScript**：原 `public/app.js` 依赖 Node HTTP/SSE、多会话、附件等接口。Cloudflare `public/app.js` 只作为最小 API 适配层，复用 UI 但不造一套新框架。
- **Edge 专属调整集中在 `public/edge.css`**：模型配置弹窗、访问令牌弹窗、单会话说明、持久任务状态和定时提醒。后续改原版设计时可同步样式，而不必维护完全独立的设计。
- 当前没有实现多会话、归档、Fork、附件、停止任务、人工触发 Worker 崩溃，因此相应原版控件已隐藏/不渲染，**不能仅有按钮而没有 API**。
- **移动端**继续使用原版 CSS 抽屉模式；菜单和模型弹窗通过 Edge 适配脚本绑定。
- UI 完整浏览器体验还需要远端部署或真实浏览器回归，CI 的静态 DOM 校验不能替代交互测试。

## 范围与原则

保持 Workers + SQLite-backed Durable Objects + PiHarness；`faux` 免费演示仍可用。真实大模型通过 Pi AI 的 `createProvider` 接入，**不绕过 Pi Durable 会话和任务提交**。

### P0-1 模型配置（已实现代码，待远程验证）

- 访问令牌授权后，打开同一页面的模型设置面板。
- 协议：OpenAI Chat Completions / OpenAI Responses / Anthropic Messages / Faux。
- 配置：HTTPS Base URL、模型 ID、API Key、Context Window、Max Output Tokens、Reasoning 开关。
- 通过 `PUT /api/model` 保存；`GET /api/model` 只返回模型元信息和 `hasKey`，不回传 API Key。
- Key 先使用 AES-256-GCM 加密，密文保存在 Durable Object SQLite；派生密钥由 Cloudflare Secret `ACCESS_TOKEN` 提供。更换访问令牌会导致原 Key 无法解密，需在页面重新填写。
- URL 必须 HTTPS，拒绝本机、私有网络与 URL 中嵌入的账号密码；更换协议或地址时不得静默复用旧 Key。
- 更换模型前检查 PiHarness 未完成的任务；避免中途切换 Provider。

### P0-2 聊天（已实现代码，待远程验证）

- 发送多行文字，按 Enter 提交、Shift+Enter 换行。
- 仍使用 PiHarness `submit()`、`pending()` 与 `session().messages()`。
- 真实模型返回显示在同一聊天界面，刷新/关网页不清空已持久化的会话。
- 支持重试幂等的 `operationId`。
- Faux 仍作为不调用外部模型、无 Token 费用的验证入口。

### P0-3 兼容性与安全回归

- Node 内置测试：协议校验、私有网络 URL 拒绝、密钥 AES-GCM 正确解密、错误访问令牌无法解密、Provider 注册。
- GitHub Actions：`npm run check` + Wrangler `deploy --dry-run`。
- 在真实 Cloudflare Free 账户中验证：保存 OpenAI Key、发送真实消息、切换 Anthropic、刷新持续化历史、重启后再次对话。
- 记录免费计划 CPU / 请求配额与 PiHarness Beta 兼容性；**只有上述真实验证通过后才能标记生产可用**。

## 下一批任务（P1：本次未交付）

1. **连接测试**：前端按钮触发一次明确告知可能收费的最小模型请求，区分鉴权失败、404 模型不存在和额度限制；失败信息脱敏。
2. **多模型 Profiles**：保存多个模型配置、选择默认模型、导入导出不含 API Key 的 JSON；加密密钥轮换。
3. **会话管理**：新建/切换/重置会话，支持多会话列表与导出 Markdown。
4. **工具恢复**：从 VPS 版挑选 `todo`、`memo`、`current_time`；所有副作用需保证重放幂等。
5. **可观测性**：错误状态、运行耗时、Token 使用与费用估算、限速和资源配额提示。
6. **安全增强**：更严格的目标地址验证、Cloudflare Access、Key 撤销/删除接口、数据备份；上线前审计多用户风险。

## 真实部署后的验收流程

1. 使用原项目 `faux` 测试聊天/提醒（免费）。
2. 登录设置页面，选择 `OpenAI · Chat Completions`、`https://api.openai.com/v1`、填写所使用的模型与真实 API Key，保存。
3. 发送“你好，请用一句话回复”，观察模型回复；关闭再打开浏览器，检查历史仍在。
4. 切换到 `Anthropic · Messages`、`https://api.anthropic.com`，使用有相应权限的 Key 与模型 ID 测试。
5. 将 Key 留空并保持原协议 + Base URL，可更换模型 ID 而不重新输入；切回 Faux 不再调用付费模型。
6. 在正在执行的任务期间重试切换模型，应明确提示等待，不能破坏进行中的操作。

**费用说明：** Cloudflare 平台有免费配额；真实 OpenAI、Anthropic 或第三方兼容 API 的调用按该服务商计费，无法保证 $0。UI 不应自动执行付费连接测试。

官方参考：[Cloudflare PiHarness](https://developers.cloudflare.com/agents/harnesses/pi/) · [Pi AI custom providers](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)。
