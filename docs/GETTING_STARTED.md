# 快速开始：从零运行 Pi Durable Assistant

这份手册只针对 **当前 `main`**，不需要先安装任何未合并的 PR 功能。目标是先证明网页、会话、任务、重启恢复可用，再决定是否接真实模型或部署 VPS。

## 准备环境

- Node.js **22.13 或以上**、npm、Git；推荐 macOS / Linux。Windows 建议使用 WSL2。
- **首次演示不需要 API Key**，也不需要 Docker、Redis、PostgreSQL 或云服务器。
- `LLM_API=faux` 是模拟模型，不会访问真实 LLM 接口，也不会为任意任务生成智能答案。

## A. 本机运行（推荐第一步）

```bash
git clone https://github.com/xiaomoBoy/pi-durable-assistant.git
cd pi-durable-assistant
node --version
npm ci
npm run check
npm test
LLM_API=faux npm run dev
```

访问 **http://127.0.0.1:3000**。如果端口占用，可改 `PORT=3001 LLM_API=faux npm run dev`，并访问 3001。

第一次打开后：

1. 点击「新建会话」，输入「演示一下持久任务」，模拟模型将按固定剧本处理，不会真正理解这句话。
2. 打开右下角「任务中心」，创建一个单次计划：内容填 `检查任务状态`、首次延迟填 `0.25`（15 秒）、重复间隔填 `0`。正常应能看到任务状态变化。
3. 再创建一个后台子 Agent 任务并查看其子会话和完成结果。
4. 如需演示进程崩溃恢复，可在**本地开发模式**用界面的「模拟进程崩溃」按钮；`scripts/dev.sh` 会拉起 Node 进程。等待页面自动重新连接，查看「启动次数」和会话任务是否仍存在。

**注意：** `faux` 会执行固定工具调用脚本，不能作为真实研究、联网抓取或微信模型能力的验收。

## B. 接入真实模型（可选）

```bash
cp .env.example .env
```

用文本编辑器填写：

```dotenv
LLM_API=openai-completions
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=YOUR_OWN_KEY
LLM_MODEL=your-provider-model-id
```

上面 URL、Key 和模型 ID 只是占位符，**不能直接运行**。使用供应商实际提供的地址和名称，按提供商文档选择 `openai-completions`、`openai-responses` 或 `anthropic-messages`。

```bash
set -a
. ./.env
set +a
npm run dev
```

浏览器创建**新会话**后测试：请它读取一个公开网页、设置提醒、创建后台子 Agent。若出现 401、404、模型不支持或重定向错误，先核查 `LLM_API` 类型与 `LLM_BASE_URL` 是否匹配。**LLM 费用属于模型服务商，不由项目内的零值费率配置承担。**

Shell 导入 `.env` 的方式适用于示例中的简单 `KEY=value` 配置；配置值里如果含有 Shell 特殊字符，请正确加引号或使用系统环境变量注入，**不要把密钥发到 Issue**。

## C. 使用浏览器附件

主分支已经支持浏览器附件，而不只是文字：

| 项目 | 支持情况 |
| --- | --- |
| 图片格式 | PNG / JPEG / WebP / GIF，校验文件签名 |
| 文本格式 | TXT / Markdown / CSV / JSON，以及 UTF-8 文本或代码类文件 |
| 每次文件数 | 最多 5 个 |
| 单张图片 | 最多 5 MiB |
| 单个文本文件 | 最多 200 KiB |
| 单次总大小 | 最多 10 MiB |
| 不支持 | SVG 图片、二进制程序，以及未列入的媒体文件 |

在聊天输入框点击回形针选择文件，或拖动文件到聊天区域，提交消息后可看到附件。图片是否能够被模型理解，取决于你配置的**模型 API 是否支持图像**；`faux` 演示不能证明模型视觉能力。即使网页端支持图片，**微信 iLink 通道当前仍不解析图片/视频/文件附件**。

## D. 升级至 Docker/VPS

1. 先阅读 [部署与备份注意事项](DEPLOYMENT.md)；在公网开放前配置 HTTPS、强密码、备份。
2. 再按 [配置说明](CONFIGURATION.md) 填写 `DEMO_PASSWORD` 与模型。
3. 使用 `docker compose up -d --build`，访问反向代理后的 HTTPS 地址。
4. 需要微信时再按 [微信 iLink 手册](WECHAT.md) 启用 profile、扫码绑定。

## E. 核对与常见误区

- **网页断开 ≠ 任务取消**：任务运行于后端，页面重新打开或重连即可查看结果。
- **计划间隔 ≠ 每天某时**：`1440` 是每隔 24 小时，不保证夏令时变化后仍是当地 9 点。
- **任务完成 ≠ 必然手机推送**：不配置 `NOTIFY_WEBHOOK_URL` 就只在应用中看到结果，`errors` 默认不会发成功通知或正常提醒。
- **进程可恢复 ≠ 数据可恢复**：SQLite 数据卷仍需要备份；误删卷或磁盘损坏不在崩溃恢复保障范围内。
- **PR 已测试 ≠ 主分支已启用**：知识库、人工审批、通用 Outbox 等增强功能仍需独立验收与合并。

遇到问题按 [故障排查](TROUBLESHOOTING.md) 查看，提供已脱敏的日志和复现步骤即可。
