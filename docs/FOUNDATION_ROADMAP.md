# 六项基础能力加固计划（2026-10-10）

本计划是 **Pi Durable 小助手**的运行时基础设施工作，和独立的 [v4 知识库需求](KNOWLEDGE_FEATURE_REQUIREMENTS.md) 不冲突。

> 核心原则：**持久化不是权限系统、不是沙箱、不是外部调用恰好一次交付**。不重写 Pi Durable 已具备的 Task、Document、事务或压缩机制。不引入大型任务框架或一堆新依赖。
>
> 交付方式：每阶段独立 PR + 测试 + 安全边界 + 实际验收，前项验收后再实施后项。已有待验收的 [Obsidian PR #4](https://github.com/xiaomoBoy/pi-durable-demo/pull/4) 保持独立。

| 顺序 | 缺失基座 | 最小可交付功能 | 判定标准 | 当前状态 |
|---|---|---|---|---|
| F1 | 工具执行层 | 文件只读、受控输出文件、工具动作统一的作用域；**任意 Shell 默认禁止**，若确需执行命令，必须先明确隔离策略 | 任何请求不能读取工作区外文件，命令无法直接执行 | 首批实现文件工作区；命令沙箱未实现 |
| F2 | 操作授权与人工审批 | 读操作自动；所有文件写入先提议，明确在管理界面批准，审批和执行状态持久化 | 未审批绝不落盘、进程重启不丢审批、重复执行不产生多份文件 | 首批实现 |
| F3 | 可靠通知与外部副作用 | 通用 Webhook/飞书 Durable Outbox、事务入队、自动重试、blocked 手动恢复；微信独立 Outbox 保留 | 任务成功与事件入队原子提交；重启后重试，保留稳定 ID | **已开发，待验收**（参见 [手册](FOUNDATION_F3_ACCEPTANCE.md)） |
| F4 | Artifacts 成果系统 | 工作区文件登记、按任务归属、受控下载、后续可导出 | 任务报告可查可下载，重启后存在 | 首批提供基本文件下载；任务级索引未完成 |
| F5 | 模型与成本 | 会话模型选择、真实用量与缓存口径、费率设置、预算保护 | 同任务用量可核对，不虚构费用；超预算时按策略拒绝新执行 | 待开发 |
| F6 | 运维恢复 | 健康检查、异常任务追踪、可靠 SQLite 快照备份、恢复演练 | 有备份文件、演练确实成功、出错可定位 | 待开发 |

## 第一批 F1 + F2 具体设计

### 执行范围

- 默认不开启受控工作区；显式设置 `WORKSPACE_ENABLED=1`，目录 `WORKSPACE_ROOT=/workspace`。
- Agent 只有 `workspace_list`、`workspace_read`、`propose_workspace_write` 三个工具。禁止任意命令执行和网络上传。本阶段仅支持 `.md/.txt/.csv/.json`。
- 不接触 Obsidian 和服务器宿主文件；工作区是**新的独立 Docker 命名卷**，不要把 `/root`、`/home`、SSH、Obsidian 或私人账户目录挂进去。
- 凡是写入，工具只生成 Durable `PendingActions` 中的 `pending` 记录；网页登录者在任务中心完整查看正文，然后批准/拒绝。批准后异步落盘，`done` 与 `failed` 可审计。
- 同一工具调用通过 `conversationId:callId` 幂等，同一个 HTTP requestId 通过稳定键幂等；执行中崩溃可重复覆盖**同一内容**（按 SHA-256 检查），避免生成第二份文件。
- 文件写入使用临时文件 + fsync + rename；文件类型、大小和路径受限，阻止父路径跳转、隐藏目录、符号链接。工作区自己不能被当成安全沙箱：模型生成的文件不能不经额外审核就当可执行代码运行。

### API

在当前 Basic Auth 和同源写请求校验之下：

| 方法 | 接口 | 作用 |
|---|---|---|
| GET | `/api/foundation/status` | 受控工作区是否启用、等待审批数 |
| GET | `/api/foundation/actions` | 审批列表（不默认回传完整正文） |
| GET | `/api/foundation/actions/:id` | 查看完整提议内容，以便作出决定 |
| POST | `/api/foundation/actions` | 创建写入提议：`{path,content,overwrite?,requestId?}` |
| POST | `/api/foundation/actions/:id/approve` | 批准并等待异步执行 |
| POST | `/api/foundation/actions/:id/reject` | 拒绝提议 |
| GET | `/api/workspace/files` | 查看文件名 |
| GET | `/api/workspace/download?name=` | 强制附件下载；不能内联执行 |

## 验收 F1 + F2

先在独立测试分支运行 `npm run check`、`npm test`，验证：

1. 未启用工作区时现有聊天、提醒、子 Agent、微信通道不回归。
2. 新建文件提议后，即使用户关闭页面/进程重启，**没批准前没有文件**。
3. 网页审批查看完整内容、批准后下载 `.md`，重启后文件和审批记录仍存在。
4. 拒绝 `../` 越权、符号链接、非授权文件类型；跨源 POST 不能批准。
5. 重发相同 requestId 返回相同审批单；内容与旧 requestId 不一致时拒绝。
6. CI 仅等于模拟环境测试通过，真实 VPS 和微信消息还需要你自行验收。**本阶段不声称已完成命令执行沙箱**。

## 后续详细实施次序

**F3 Outbox（本阶段已实施）**：在任务完成的 Durable 事务中记录通知事件，独立 worker 消费 Outbox；网络失败指数退避、永久性错误标记 blocked，接收方按 eventId 幂等。微信发送特有逻辑保留，未强行合并。详见 [F3 验收](FOUNDATION_F3_ACCEPTANCE.md)。

**F4 Artifacts**：输出文件与任务 ID/会话 ID/哈希关联，防误删、限制容量，提供任务中心筛选与下载，不存重复的大型对话正文。

**F5 模型与成本**：先准确曝光 `pi.usage` 已有用量；增加用户显式配置的模型费率和只针对新任务的预算阻断，再扩展按会话选择同类型 API 的模型。模型中途切换需保证会话恢复可用。缓存读写、账单区别必须标注。

**F6 可观测/备份**：提供健康及任务告警视图，SQLite 在线一致性快照（不能直接复制运行中的数据库文件），离线恢复演练，明确备份保留和敏感数据保护。默认仅异常通知。

## 不做

- 不把编辑工作区误称完整沙箱；未经容器/权限隔离验证，不增加 `exec(shell)` 或通用 `bash` 工具。
- 不自动执行未知脚本，不自动修改 Obsidian 权威文件，不自动发布 X/微信朋友圈。
- 不承诺外部平台 exactly-once；幂等保护的强度受第三方接口能力制约。
