# Pi Durable Assistant

**可自托管的持久化 AI Agent（Durable AI Assistant）**：基于 [Pi Durable](https://github.com/earendil-works/pi) 构建，支持进程崩溃后恢复任务、长期后台执行、Subagents、多会话 Web UI、定时任务和可选的微信 iLink 接入。

**Self-hosted AI agent with crash recovery, durable workflows, background subagents, scheduled tasks, SQLite persistence, a browser UI and an optional WeChat bridge.** [English README](README.en.md)

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-43853d?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![CI](https://github.com/xiaomoBoy/pi-durable-assistant/actions/workflows/v3-ci.yml/badge.svg)](https://github.com/xiaomoBoy/pi-durable-assistant/actions/workflows/v3-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **项目状态：个人单用户项目 / 可体验的实验性实现，不是 Pi Durable 官方产品。** 当前 `main` 包含 v3 任务中心、网页附件和微信适配代码；部分知识库、文件审批和可靠通知增强功能仍在独立 PR 中，**未合并到主分支**。生产环境请自行做好 HTTPS、访问控制和 SQLite 备份。

![Pi Durable Assistant 网页界面：聊天、任务中心和运行状态](docs/screenshot.png)

## 为什么做这个项目

普通聊天机器人在进程退出后往往丢失正在执行的工作。这个项目把 Pi Durable 的任务、会话和 Document 持久化机制封装为**一个可以打开浏览器实际使用的个人 Agent**。可在任务进行中重启进程，再查看恢复后的执行结果；同时保留 SQLite 中的会话与任务状态。

核心技术：**Pi Durable 1.1.0 / Node.js 22 / SQLite / 原生 JavaScript + SSE / Docker Compose**。不需要前端构建或独立数据库服务。

## 已实现的功能

| 功能 | 当前 `main` 的行为 |
| --- | --- |
| Durable Agent / 断点恢复 | 检查点、SQLite 持久化、进程重启后恢复可恢复的任务 |
| Web UI / 多会话 | 浏览器聊天、多会话、Fork、SSE 状态同步、Token 用量展示 |
| 前台与后台 Subagents | `delegate` / `delegate_background`，后台任务可查看、停止和恢复 |
| 计划与提醒 | 一次性或按固定分钟间隔重复的任务；可暂停/恢复/取消 |
| 持久记事本 | `todo` / `memo`，保存任务笔记 |
| 网页附件 | 图片 PNG/JPEG/WebP/GIF 和 UTF-8 文本、代码文件（有限制；见使用说明） |
| 主动通知 | 可选通用 Webhook / 飞书文本机器人；主分支目前为尽力发送 |
| 微信 iLink | 可选 `wx-bot` 容器，文字与语音转写文字收发；其他媒体不解析 |
| 导出 | 当前会话用户与助手的可见文字导出为 Markdown |

**尚未在 `main` 交付：** Obsidian 只读检索（[PR #4](https://github.com/xiaomoBoy/pi-durable-assistant/pull/4)）、受控工作区及审批（[PR #5](https://github.com/xiaomoBoy/pi-durable-assistant/pull/5)）、持久通知 Outbox（[PR #6](https://github.com/xiaomoBoy/pi-durable-assistant/pull/6)）。PR 的代码和自动化测试不能视为已经部署上线。

## 3 分钟本地体验（不需要 API Key）

需要 **Node.js ≥ 22.13**、npm 和 Git：

```bash
git clone https://github.com/xiaomoBoy/pi-durable-assistant.git
cd pi-durable-assistant
npm ci
npm run check
LLM_API=faux npm run dev
```

浏览器访问 **http://127.0.0.1:3000**，创建会话并提交一条消息；打开右下角「任务中心」可以创建计划任务或后台子 Agent。

`faux` 是本地**固定模拟剧本**，只用于体验持久化、UI 和恢复机制；它不是通用 AI 模型，不会根据你的自然语言完成真实研究。完整上手路径见 [快速开始与验收](docs/GETTING_STARTED.md)。

## 接入真实大模型

```bash
cp .env.example .env
# 用编辑器填写 .env 的 LLM_API、LLM_BASE_URL、LLM_API_KEY、LLM_MODEL
set -a
. ./.env
set +a
npm run dev
```

支持 `openai-completions`、`openai-responses` 和 `anthropic-messages` API 类型。兼容性取决于实际模型/服务商；模型费用由外部服务商或中转平台收取。请查看 [配置说明](docs/CONFIGURATION.md) 了解环境变量、安全提醒和零配置模式。

**不要把 `.env`、API Key、微信会话凭据提交到仓库或截图中。** 如果只是看演示，使用 `LLM_API=faux`，不需要填写密钥。

## Docker / VPS 部署

```bash
cp .env.example .env
# 至少配置强密码 DEMO_PASSWORD 和实际模型信息
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 pi-durable-assistant
```

默认只监听宿主机 `127.0.0.1:3300`，而非公网地址；生产部署应由 HTTPS 反向代理提供外部访问，并保留 HTTP Basic Auth（用户名 `demo`）。请在升级前备份 Docker 数据卷，**不要执行 `docker compose down -v`**。

按顺序阅读 [部署与备份注意事项](docs/DEPLOYMENT.md) 和 [故障排查](docs/TROUBLESHOOTING.md)。若需要微信扫码，参见 [微信 iLink 接入](docs/WECHAT.md)，通过 `--profile wechat` 启动第二个容器。

## 常用操作和能力边界

**持久计划任务：** 在任务中心填写任务内容、首次延迟分钟数和重复间隔；`0` 表示单次执行，`1440` 表示每隔 24 小时。**这不是按时区/夏令时校准的每天某时 Cron**。关闭浏览器不会结束后台任务，但没有配置通知渠道就不会主动发手机消息。

**后台子 Agent：** 在任务中心提交独立任务，回到主会话后可继续聊天，完成时自动报告结果；也可以用 `delegate_background` 工具。前台 `delegate` 则会等待子 Agent 完成。

**附件：** 网页单次最多 5 个；单张图片最多 5 MiB，文本文件最多 200 KiB，总量最多 10 MiB。支持网页端图片与 UTF-8 文本/代码文件；微信图片、视频和文件**暂不具备真实解析能力**。附件内容仍通过模型请求传输，请不要上传不希望发送给模型服务商的敏感数据。

**通知：** `NOTIFY_MODE=errors|all|off`；`errors` 只发明确失败的后台任务通知，`all` 才包含提醒和成功结果。当前主分支的通用 Webhook/飞书投递是**尽力而为**；网络故障可能丢消息。微信另有独立持久发送队列。详细配置见 [配置说明](docs/CONFIGURATION.md)。

## 文档导航

| 想做什么 | 阅读 |
| --- | --- |
| 直接跑起来并确认功能正常 | [快速开始与验收](docs/GETTING_STARTED.md) |
| 查看所有 `.env` 项和模型/API 接法 | [配置说明](docs/CONFIGURATION.md) |
| 在 Docker / VPS 上运行及保护数据 | [部署与备份注意事项](docs/DEPLOYMENT.md) |
| 扫码连接微信、处理 iLink 问题 | [微信接入手册](docs/WECHAT.md) |
| 处理启动失败、权限、模型与消息问题 | [故障排查](docs/TROUBLESHOOTING.md) |
| 理解 v3 Durable 任务架构与 API | [v3 设计与验收记录](docs/V3_PLAN.md) |
| 了解正在规划的知识库能力 | [v4 功能需求](docs/KNOWLEDGE_FEATURE_REQUIREMENTS.md) |
| 提升 GitHub 站内搜索与项目展示 | [GitHub Discoverability / SEO 清单](docs/GITHUB_DISCOVERABILITY.md) |
| 项目架构与历史设计说明 | [SPEC.md](SPEC.md) |

## 技术结构

- `server.mjs`：HTTP API、鉴权、SSE、静态文件与消息处理。
- `lib/agent.mjs`：Pi Durable Harness、模型与 Agent 工具。
- `lib/v3.mjs`：周期任务、后台 Subagent、管理命令和可选通知。
- `lib/attachments.mjs`：网页图片/文本附件的校验与转换。
- `lib/wechat.mjs`：微信通道的会话绑定和消息持久化。
- `public/index.html` + `public/app.js` + `public/style.css`：浏览器聊天 UI。
- `public/v3.js`：任务中心抽屉，不需要前端打包工具。
- `tests/`：Node 测试、HTTP 集成、模拟断点恢复和微信通道回归。

```bash
npm ci
npm run check
npm test
```

CI 使用本地 `faux` 模型和模拟通道，不等于真实微信扫码、生产模型、真实浏览器和 VPS 的端到端验收。若要反馈问题，请附操作系统、Node/Docker 版本、复现步骤及**已脱敏**的错误日志。

## 许可证

[MIT](LICENSE)。本项目并非 Pi Durable、微信或任何模型服务商的官方发行版。
