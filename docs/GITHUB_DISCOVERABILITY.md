# GitHub 搜索与项目展示优化清单

本页记录针对仓库 [xiaomoBoy/pi-durable-assistant](https://github.com/xiaomoBoy/pi-durable-assistant) 的 **GitHub Discoverability / SEO** 方案。重点是准确描述项目定位，提高 GitHub 站内搜索和 Google 等搜索引擎理解的机会；**不承诺排名或收录时间**。

## 目前的仓库定位

名称 `pi-durable-assistant` 已经比旧名 `pi-durable-demo` 更准确，**不建议为了 SEO 再次更名**。项目的主要关键词应围绕真实已交付能力：

- 主关键词：**Pi Durable / Durable AI Agent / Personal AI Assistant**
- 功能关键词：**crash recovery / long-running tasks / background subagents / scheduled tasks / self-hosted / WeChat iLink**
- 技术关键词：**Node.js / SQLite / JavaScript / Docker Compose / SSE**

不要把未合并的 Obsidian 自动写回、任意 Shell 执行、通用持久通知、生产级多租户平台等放入 About 或作为已经交付的搜索词。

## 1. About 文案（可直接复制）

在仓库首页右上方 **About → 齿轮图标** 中，将 Description 改成：

> Pi Durable 自托管 AI Agent：crash recovery, persistent tasks, subagents, scheduling, Web UI & WeChat iLink (Node.js + SQLite).

设计原则：中英结合，既让中文受众知道是什么，又涵盖英文检索的主关键词；不是写十几个毫无关系的词。**当前 GitHub 连接器只能改仓库文件与 PR，不能直接修改 About/Topics 设置，所以需要仓库管理员在网页完成该项。**

Homepage：如果没有持续维护的公开产品站或文章入口，暂时**留空**；不要填写临时 IP、内网地址或未上线的网站。

## 2. Topics（建议 12 个）

```text
pi-durable
pi-agent
ai-agent
durable-agent
personal-ai-assistant
self-hosted
subagents
long-running-tasks
task-scheduler
wechat-bot
nodejs
sqlite
```

保留已存在的 `ai-agent`、`pi-agent`、`pi-durable`，补充真正相关的功能与技术标签，避免 20 个标签都重复表达 Agent。GitHub 官方允许最多 20 个 Topic，要求使用小写字母、数字与连字符。参考：https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics

操作路径：仓库主页 → 右上角 About 旁齿轮 → Topics → 逐项输入 → Save changes。

## 3. README 已调整的可发现性元素

- H1 使用 **Pi Durable Assistant**；首段同时解释 Durable AI Agent、自托管、崩溃恢复、Subagents、微信等真正可用的能力。
- 简体中文为主，新增 `README.en.md` 作为英语检索和国际开发者入口。
- README 第一屏放 CI、MIT、截图、功能价值和准确的项目状态；紧接着是可复制的本地启动命令。
- 安装、配置、部署、问题排查分离成独立文档，减少 README 长篇配置说明。
- 所有项目内文档优先使用相对链接，不依赖旧的 `pi-durable-demo` URL。
- 已区分 **`main` 当前支持**与仍在 PR 审查的功能，避免“关键词吸引点击后功能不存在”。

## 4. Social preview（由仓库管理员上传）

推荐在 GitHub **Settings → General → Social preview** 上传一张项目介绍图。GitHub 官方建议：

- **1280×640 px**，PNG/JPG/GIF，**小于 1 MB**。
- 标题大字：`Pi Durable Assistant`
- 一句话副标题：`Self-hosted Durable AI Agent`
- 最多三个技术/功能短词：`Crash Recovery · Subagents · WeChat`
- 使用网页截图或极简图形作为视觉证据，不填不存在的数字/性能宣称。

官方说明：https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview

**注意：**README 里插入一张图并不等于配置好了 GitHub 链接的社交分享预览。Social preview 是单独的 GitHub 仓库设置。当前 `docs/screenshot.png` 可作为内容参考，但要重新导出满足尺寸/体积的图片。

## 5. 其他可选提升

- 若有自己写的公开 Pi Durable 入门文章或项目实操教程，建议在文章中**自然链接到本仓库**，仓库 README 可在后续加入可靠的文章入口，避免互相指向失效地址。
- 保持 Actions CI 绿灯，README 常驻自检命令；以后每次合并新功能都同步修改 README 的功能表。
- 有真实使用截图、短录屏时可加入 `docs/` 并在 README 展示，但不要上传 token、微信二维码/登录态、私有工作流或服务器配置。
- 不推荐为了“SEO”给需要 Basic Auth 的私人 Web UI 加公开搜索引擎索引或暴露业务数据；GitHub 发现性与个人 Agent 服务端可见性是**两个不同目标**。

## 6. 完成检查

- [x] 仓库命名符合真实产品定位（现有）
- [x] 中英关键词自然出现在 README 首屏
- [x] 功能状态和真实操作一致
- [x] 简体中文 + 英文 README
- [x] 文档导航、截图与启动命令
- [ ] GitHub About Description 更新（需要管理员在 UI 操作）
- [ ] GitHub Topics 更新（需要管理员在 UI 操作）
- [ ] Social preview 上传（需要管理员在 UI 操作）

SEO 是帮助找到项目，不是把单用户原型包装成成熟 SaaS。
