# Pi Durable 小助手（v3）

基于 [Pi Durable](https://earendil.com/posts/pi-durable/) 的**网页版、单用户个人 Agent**。不只是聊天：它可以持久执行任务、维护记事本、派出独立子 Agent、定时执行、在进程崩溃后恢复，并在界面里查看和管理这些工作。

项目既保留用于文章/录屏的演示模式，也提供可长期试用的「任务中心」。当前依赖固定在 `@earendil-works/pi-durable@1.1.0`，升级 API 前应以实际安装版本为准。

![项目界面](docs/screenshot.png)

## 目前能做什么

| 功能 | 使用方式 / 行为 |
| --- | --- |
| **断点恢复** | 任务执行中模拟进程崩溃，重启后从 Durable 检查点继续 |
| **记事本** | Agent 使用 `todo` / `memo` 维护待办、备忘；分叉会话继承对应历史状态 |
| **临时提醒** | 让 Agent 执行 `remind_me`，到点投递回会话；任务中心可取消 |
| **周期计划** | 任务中心新建单次或固定分钟间隔任务；支持暂停、继续、取消 |
| **前台子 Agent** | `delegate` 派子会话，并等待结果返回 |
| **后台子 Agent** | `delegate_background` 或任务中心直接创建；主会话无需等待，支持查看、停止和崩溃恢复 |
| **任务管理** | 右下角「任务中心」查看计划、提醒、后台子 Agent 及其状态 |
| **可选主动通知** | 向通用 Webhook 或飞书机器人发送事件；见下方通知说明 |
| **会话导出** | 任务中心导出当前会话的用户与助手文字为 Markdown |
| **会话分叉与多端同步** | Fork、同一会话多浏览器同步、steer 插话及 follow-up |
| **任务状态展示** | SSE 推送活动任务树、Token 统计、进程启动次数；吉祥物「小 D」反映运行状态 |

## 微信 iLink 通道（可选）

现在可以通过独立的 [wx-bot](https://github.com/lawrencewzen/wx-bot) 容器接入微信 ClawBot，将微信文本消息送进 Pi Durable 会话，并将最终回复发回微信。后台子 Agent、计划任务与网页使用同一 Durable Runtime；进程重启后保留会话绑定和未发送消息。默认未启用微信，原有网页版不会受到影响。

- 部署和扫码步骤：[微信接入手册](docs/WECHAT.md)。
- 配置 `.env` 中的 `WECHAT_ENABLED=1`、`WECHAT_WEBHOOK_KEY`、`WECHAT_SEND_TOKEN`（两个不同的随机密钥）。
- `docker compose --profile wechat build`，先 `docker compose up -d pi-durable-demo`，再 `docker compose --profile wechat run --rm wx-bot --config /etc/wx-bot/config.json login primary`，最后 `docker compose --profile wechat up -d`。
- 微信消息走独立的 Bearer Auth Webhook，原有管理界面仍使用 Basic Auth。通过 `GET /api/wechat/status` 查看通道状态。
- 当前只保证文本和语音转写文本链路；媒体附件仅占位提示，不做虚假的“已读取”分析。iLink 消息策略/限流和扫码能否成功需用真实微信验证。发出成功、标记已发送之前发生崩溃可能重复投递。

## 一、本地启动

需要 **Node.js ≥ 22.13**。先用无需 API Key 的 `faux` 模式确认基础功能：

~~~bash
npm ci
npm run check
npm test
LLM_API=faux npm run dev
~~~

浏览器打开 http://localhost:3000 ，新建会话，右下角点击「任务中心」。`faux` 是固定演示剧本，**不是通用智能模型**。开发脚本在进程退出后会自动重启，方便演示崩溃恢复。

接入真实模型：

~~~bash
cp .env.example .env
# 在 .env 填写 LLM_API、LLM_BASE_URL、LLM_API_KEY、LLM_MODEL
set -a && . ./.env && set +a
npm run dev
~~~

`LLM_API` 支持 `openai-completions`、`openai-responses`、`anthropic-messages`、`faux`。支持自定义兼容接口，但 API/模型兼容性取决于中转服务。不要提交包含真实 Key 的 `.env`。

## 二、任务中心怎么用

新建会话后打开「任务中心」，可以直接操作，无需先与模型聊天。

**1. 创建计划任务。** 输入任务内容、多少分钟后执行、重复间隔。重复间隔填 `0` 表示只执行一次；填 `1440` 代表固定每 1440 分钟重复一次。计划可暂停、恢复、取消，页面显示执行次数和下一次触发时间。

也可以让真实模型调用 `schedule_task({ text, minutesFromNow, everyMinutes? })`；首次延迟支持 0.25～525600 分钟，重复间隔为 0 或 1～525600 分钟。**注意：这是固定时间间隔，不是按时区/夏令时计算的“每天上午 9 点”。** 停机期间错过的重复周期不会全部补跑。

**2. 创建后台子 Agent。** 输入独立任务，例如「研究一个公开网页并汇报」。后台任务与聊天轮次分离，任务中心可以查看子会话、停止任务；完成后结果作为 follow-up 回到主会话。真实模型也可以调用 `delegate_background({ text })`。旧版 `delegate({ task })` 仍然可用，但它会等待子 Agent 完成。

**3. 管理提醒。** `remind_me({ minutes, text })` 由 Agent 创建短期提醒。任务中心可以取消尚未触发的提醒。已进入会话收件箱的提醒可能无法撤销。

**4. 导出。** 「导出当前对话为 Markdown」只包含用户与助手的可见文字；**不包含工具输出、记事本原始 Document 或二进制附件**。

## 三、通知怎么配置

不填 `NOTIFY_WEBHOOK_URL` 时，任务仍可在后台运行，但**网页关闭后不会自动向手机推送**；重新打开原会话才能看到站内结果。

~~~dotenv
# 目标机器人 / 接收端的 Webhook URL（不要提交到 Git）
NOTIFY_WEBHOOK_URL=
# generic 或 feishu
NOTIFY_WEBHOOK_KIND=generic
# errors（默认）/ all / off
NOTIFY_MODE=errors
~~~

- `errors`：**只推送明确标记失败的后台任务**；正常提醒、计划触发及任务成功不会外推。
- `all`：推送后台结果、正常提醒、计划触发；若想关掉网页后仍收到提醒，请设置这个值。
- `off`：关闭通知。

`generic` 提交 JSON `{ id, type, text, failed, at }`，并附带 `X-Pi-Event-ID`；`feishu` 使用飞书机器人文本消息格式。通知属于**尽力投递**，目前没有持久 outbox、失败重试或 exactly-once 保证；接收方可按事件 ID 去重。

## 四、Docker / VPS 部署

~~~bash
cp .env.example .env
# 必须填写 DEMO_PASSWORD；再填写模型配置和可选通知配置
docker compose up -d --build
docker compose logs -f
~~~

默认 Compose 把容器的 3000 端口仅映射到宿主机 `127.0.0.1:3300`，SQLite 存储在 Docker 命名卷。容器以非 root 用户运行，配置了自动重启、只读根文件系统和基本资源限制。

建议仅通过 **HTTPS + Nginx 反向代理**对外提供服务。身份验证使用 HTTP Basic Auth，用户名固定为 `demo`、密码来自 `DEMO_PASSWORD`。`NODE_ENV=production` 时**没有配置密码会拒绝启动**；在无密码的非生产模式下，Node 服务只监听 `127.0.0.1`。

Nginx 的 SSE 配置示例：

~~~nginx
location / {
    proxy_pass http://127.0.0.1:3300;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
~~~

生产模式默认禁止 `POST /api/crash`。只有确实需要录制崩溃恢复演示时才临时设置 `ENABLE_CRASH_DEMO=1`，录制完立刻关闭。**不要用 `docker compose down -v` 更新版本**：`-v` 会删除持久化数据卷。更新前应备份 SQLite 数据卷。

## 五、测试与代码结构

~~~bash
npm ci
npm run check
npm test
~~~

第一阶段合并前，GitHub Actions 完成了语法检查和 **8 项测试**，包括任务管理、请求校验、生产鉴权、任务取消以及使用 `faux` 模式模拟的进程重启恢复。这不等同于真实 LLM、浏览器及 VPS 环境的全量端到端验收。

- `server.mjs`：HTTP API、鉴权与 SSE 推送。
- `lib/agent.mjs`：模型配置、提醒、记事本、原有子 Agent 与 Harness。
- `lib/v3.mjs`：周期任务、后台子 Agent、任务管理和 Webhook。
- `lib/v3-utils.mjs`：任务时间、幂等键等纯函数。
- `lib/net.mjs`：防 SSRF 的公开网页抓取。
- `public/index.html`：原有聊天界面及状态展示。
- `public/v3.js`：独立的任务中心交互脚本。
- `tests/`：单元测试和 HTTP 回归测试。
- `SPEC.md`：架构与版本规格。
- `docs/V3_PLAN.md`：v3 验收、修复记录和第二阶段待办。

## 六、目前的限制

这是单用户项目，不具备多租户隔离。取消任务与消息投递之间仍可能出现竞态，已经投递到会话 inbox 的消息无法撤销。通知尚无持久重试队列；完整的 Cron/时区、模型成本核算、长会话增量 SSE 与文件成果管理留待下一阶段。公网部署前需自行做 HTTPS、Docker 持久卷备份及真实环境验证。

## 许可证

MIT
