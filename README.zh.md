<h1 align="center"><img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/spark.svg" alt="" width="22" height="22"> Oh My Claude</h1>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

<p align="center">
  <strong>在 dsh 里原生使用 Claude Code</strong>
</p>

<p align="center">
  <em>把你已登录的 Claude Code CLI 作为 dsh 的一等模型提供方：无需 API key，无需额外服务，没有运行时依赖。</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-oh-my-claude"><img src="https://img.shields.io/npm/v/dsh-oh-my-claude?style=flat&color=cb3837&logo=npm" alt="npm 版本" /></a>
  <img src="https://img.shields.io/badge/host-dsh-6c5ce7?style=flat" alt="dsh" />
  <img src="https://img.shields.io/badge/drives-Claude%20Code%20CLI-d97757?style=flat" alt="Claude Code CLI" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?style=flat&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/build-Bun-f472b6?style=flat&logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/runtime%20deps-zero-45cfa0?style=flat" alt="零运行时依赖" />
</p>

<p align="center">
  <sub>借助 AI 构建，也欢迎更多 AI 参与。欢迎 AI 编程智能体提交贡献，请先阅读 <a href="https://github.com/lcestou/dsh-oh-my-claude/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>。</sub>
</p>

---

把 Claude Code CLI 作为 [dsh](https://github.com/deepseek-ai/dsh) 的 LLM 提供方。每次请求都以 stream-json 输入输出驱动 `claude -p`，因此沿用 Claude Code 已有的登录、hooks、CLAUDE.md、MCP 服务器和速率限制。无需 API key。插件直接使用 CLI 自己的协议（Agent SDK 封装的就是它），所以没有运行时依赖。

插件界面跟随 dsh 的语言设置（设置 → 通用设置 → 语言）。详细文档目前只有英文版，下方链接均指向英文文档。

## 功能一览

<p><img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/shield-menu.png" width="640" alt="Claude 会话中的 dsh 访问权限菜单：计划、询问、接受编辑、自动、不再询问和绕过六项"></p>

这个盾牌是 dsh 自带的控件。在 Claude 会话里，它的各项变成 Claude 的六种权限模式，每项都标出它对应的 dsh 访问级别。

<p><img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/panel-tabs.gif" width="640" alt="Oh My Claude 面板在记忆、回溯、改动和旁问标签之间切换"></p>

输入框旁的一个 `✻` 按钮打开整个插件：记忆、说明、技能、回溯、改动、MCP、旁问、诊断、任务和调校；会话还是空白时另有一个恢复标签。

<p><img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/panel-changes.png" width="640" alt="改动标签列出工作区差异及每个文件的行数"> <img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/panel-asides.png" width="640" alt="旁问标签，一个问题在标签栏上方展开"> <img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/panel-mcp.png" width="640" alt="MCP 标签的添加服务器表单，已填好名称、命令和参数"></p>

<p><img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/cost-row.png" width="640" alt="dsh 底部统计行，末尾是 Claude 会话费用和缓存 token 数"></p>

费用和缓存 token 数是 dsh 自己算不出的两个数字，它们出现在 dsh 底部的统计行里。会话花费超过你设定的额度后，这个标签会变成橙色。金额按 API 价格计算；使用 Claude 订阅时不会向你收取这笔钱。

<p><img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/context-usage.png" width="300" alt="dsh 上下文圆环弹窗，显示 Claude 套餐用量窗口和 CLI 自己的上下文明细"> <img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/phone-panel.png" width="300" alt="手机上的面板，以底部弹层形式显示在输入框上方"></p>

套餐用量和 CLI 自己的上下文明细显示在 dsh 的上下文圆环弹窗里。在手机上，面板变成底部弹层。

<p><img src="https://raw.githubusercontent.com/lcestou/dsh-oh-my-claude/main/docs/media/add-workspace.png" width="640" alt="dsh 的选择工作区目录对话框，底部有主机下拉框，列出本机和一台 SSH 主机"></p>

保存一台 SSH 主机后，dsh 自带的添加工作区对话框会多出一个主机下拉框：那台主机上的文件夹可以成为这里的工作区，其中的会话在那台主机上运行 Claude Code。

<sub>截图由 <code>tools/playwright/tour.ts</code> 生成。</sub>

## 安装

需要 Claude Code CLI 在 `PATH` 上并已登录（`claude --version` 能运行，打开 `claude` 不会要求登录），以及 dsh 0.1.5-rc.1 或更新版本。别的都不需要：没有 API key，没有 Node 构建步骤。

```sh
dsh plugin --profile web add dsh-oh-my-claude                        # 从 npm 安装
dsh plugin --profile web add github:lcestou/dsh-oh-my-claude         # 或直接从仓库安装
systemctl --user restart dsh-web.service   # 或用你自己的方式重启 `dsh web`
```

这个包声明了 dsh bundle，所以 `dsh plugin add` 会自动把它登记到 profile 里。重启后，模型选择器里会出现 "Oh My Claude"，列出你的登录可用的模型。选一个就能开始对话。

如果选择器里显示 `Oh My Claude (未登录)`，请在运行 dsh 的机器上打开终端运行 `claude auth login`，或在 设置 → Oh My Claude → 主机 中点击登录。

**DSH Desktop**（macOS 和 Windows）通过自己的插件页面安装和更新插件，而不是 `dsh plugin` 命令：在那里添加 `dsh-oh-my-claude`，并按提示重启。从 Dock 启动的应用看不到你 shell 的 PATH，所以插件会在常见的安装目录里查找 `claude`。在 Windows 上，插件把 Claude 作为 dsh 的普通子进程运行，因此重启应用会中断正在进行的回合，需要 Unix shell 的功能（在设置里登录、SSH 主机）也不可用。服务端已按 Desktop 的方式在 Linux 上用 Electron 运行过；真实的 Mac 或 Windows 安装还没有试过。

npm 上有新版本时，设置和面板的运行环境行会出现一个带版本号的橙色标签，点击即可复制更新命令。详情以及插件在 dsh 升级后自行完成的修复，见 [Plugin updates](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#plugin-updates)。

可选，在 `~/.dsh/settings.yaml` 中：

```yaml
agent-default-model:            # 让新会话默认使用 Claude Code
  provider: claude-code
  model: claude-fable-5-1
subagent-model-selection:       # 让 dsh 子智能体也能使用 Claude Code
  enabled: true
  allowedModels:
    - provider: claude-code
      model: claude-haiku-4-5
```

想参与开发插件本身？从 [docs/developing.md](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/developing.md) 开始。

## 兼容性

dsh 只发布预发行版，客户端 API 也会在版本之间变动，所以插件的每个版本都记录它面向的 dsh 范围和实际运行验证过的 dsh。"可运行于"是代码带有兼容分支的范围；"测试于"是发版时机器上安装的那个 dsh。更新提示会从 npm 读取最低 dsh 版本，低于它的机器不会收到该版本。

| 插件 | 可运行于 dsh | 测试于 dsh | npm 标签 |
| --- | --- | --- | --- |
| 1.4.0 | 0.1.5-rc.1 至 0.1.7-rc.2 | 0.1.7-rc.2 | `latest`、`dsh-0.1.7` |
| 1.3.1 | 0.1.5-rc.1 至 0.1.6-alpha.2 | 0.1.6-alpha.2 | `dsh-0.1.6` |
| 1.2.1 | 0.1.5-rc.1 至 0.1.6-alpha.2 | 0.1.6-alpha.2 | `dsh-0.1.5` |

## 你能得到什么

1. 在 dsh 自己的选择器里使用你的登录可用的任何 Claude 模型。[Models](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#models)
2. 每个 dsh 会话都会续接它的 Claude Code 会话（包括工具历史），终端里的 `claude /resume` 看到的是同一个会话。[Sessions](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#sessions)
3. 重启 dsh 不会中断正在运行的 Claude 回合。[Restarts](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#restarts)
4. dsh 的访问权限盾牌按会话设置 Claude 的六种权限模式。[Permission mode](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#permission-mode-per-session)
5. Claude 的权限请求、提问和计划审阅都变成 dsh 对话框。[Approvals](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#approvals-and-questions)
6. 一个 ✻ 按钮打开记忆、回溯、改动、MCP 等十余个标签，全部可以用键盘操作。[The panel](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md)
7. 费用和缓存 token 显示在 dsh 底部，超过设定额度时标签变橙。[Cost pill](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#cost-pill)
8. 套餐用量（5 小时、每周、额外用量）显示在 dsh 的上下文圆环里，接近上限时变琥珀色，达到上限时变红，并在输入框上方提示。只统计会话所用模型计入的额度，由 Anthropic 判定，所以新模型无需更新插件。[Plan usage](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#plan-usage)
9. 恢复或导入任何过去的 Claude 记录，无论来自 dsh 还是终端，并可在其中搜索说过的内容。[Session browser](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#session-browser)
10. Claude 的斜杠命令和技能以 `/claude-<name>` 出现在 dsh 的斜杠菜单里。[Command bridge](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#command-bridge)
11. Claude 可以通过 MCP 使用 dsh 的子智能体、后台任务、目标和网页搜索。[dsh tools over MCP](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#dsh-tools-over-mcp)
12. 在面板里编辑本机或远程主机上的 CLAUDE.md、settings.json 和 MCP 服务器，并登录需要登录的 MCP 服务器。[Instructions](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#instructions)、[settings.json editor](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#settingsjson-editor)、[MCP](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#mcp)
13. 通过 SSH 在另一台主机上运行 Claude，或挂载多个账号。[Remote boxes and accounts](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/remote.md)
14. 用一份已脱敏的本机报告反馈问题，可复制，也可直接提交 issue。[Report a problem](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#report-a-problem)
15. 所有橙色都可以按组关闭，颜色也可以自选。[Claude look](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#claude-look)
16. 选择 dsh 往你的提示词里添加哪些内容，每一块的大小都标在标签上。[dsh context](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#dsh-context)
17. 会话所在主机有新的 Claude Code 版本时会出现卡片，并可在 dsh 里直接安装；无界面的 `claude -p` 从不自动更新。每台主机的更新渠道、自动安装和历史记录都在设置里的开关下。[Claude Code updates](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#surviving-claude-code-updates)
18. 在设置里查看最近五个版本的变化，内容来自插件自己的更新日志。[Changelog](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#changelog)
19. 按范围列出 CLI 能用到的所有技能，你自己的和项目的技能可以添加、编辑和删除。每个技能的开销来自 CLI 自己的 `/skill-doctor`，是一张可排序的表格，旁边还有其他影响用量的因素：请求最多的 MCP 服务器，以及工作的构成。[Skills](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#skills)
20. 你没在看的会话完成或停下来问你时，浏览器标签页会有标记，还可以选择弹出桌面通知。[Session notices](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#session-notices)
21. dsh 自己的目标和会话以往的每个目标，与 Claude Code 的目标和定时任务并列显示。[Tasks](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#tasks)
22. Claude 工作时你插话发送的消息，在 Claude 读取之前可以编辑或移除，也可以合并为一条编辑。编辑期间消息不会发出。“立即发送”会打断 Claude，把这条消息作为下一轮发出。[Steering](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#dsh-tools-over-mcp)
23. Claude 的工作状态行（旋转图标、动词、数字）会在本轮的标题滚出屏幕后，在输入框上方重复显示，一长串工具卡片不会再遮住 Claude 正在做的事。设置中有开关可关闭。[轮次状态](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#turn-status)
24. 在回复中选中文本，即可将其引用到消息中，或作为旁问向 Claude 提问，不占用对话本身；问题留空时，Claude 会解释这段内容。你自己消息里的引用也会像 Claude 回复中的引用一样显示：缩进，左侧有强调色竖线。[旁问](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#asides)
25. 一轮结束后，标题处保留一行收尾，和终端里一样：`✻ 烘焙了 27s · 03:21 完成`。被你停止的一轮显示 `已中断 · 想让 Claude 改做什么？`。[轮次状态](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md#turn-status)
26. 在 dsh 0.1.7 上，Claude 的工具调用显示为 dsh 自己的工具卡片，和其他提供方一样，文字在卡片之间实时输出。也可以在设置中切换回行内文本。[工具行](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/configuration.md)
27. 在工作区中新建会话时，会使用该工作区上次运行的 Claude 主机和模型。[按工作区记住模型](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/panel.md#remember-model-per-workspace)

一些你永远不必动的默认行为，比如工具结果中的密钥脱敏和挺过 CLI 自身的更新，见 [How it works](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/how-it-works.md)。

## 配置

设置分两类。设置 → Oh My Claude 下和面板调校标签里的开关立即生效，并保存在本机，所以每个浏览器看到的都一样。下面这些键在安装时配置：写在 profile 的 `cordis.patch.yml` 中该 bundle 行的 `config:` 下，dsh 下次加载插件时生效，重启 dsh 即可。dsh 自己的插件页面会列出这个插件并提供开关，但没有这些键的表单。最常改的三个键：

```yaml
permissionMode: dsh      # 跟随会话的盾牌（默认），或固定为 CLI 的六种模式之一
spawn: keeper            # Claude 在 dsh 重启后继续运行（默认）；node 或 dsh 则作为普通子进程
sshHost: ""              # "[user@]host" 通过 ssh 驱动另一台机器上的 claude
```

每个键及其默认值见 [docs/configuration.md](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/configuration.md)。

## 远程主机和账号

用不同的 `configDir` 把插件挂载两次，即可使用两个登录。在 设置 → Oh My Claude → 主机 中列出其他运行 dsh 和本插件的主机，并在它们之间切换。也可以给一台主机起个名字、填上 `user@host`，通过 SSH 驱动那里的 `claude`，远端只需要安装 CLI；Tailscale 和 WireGuard 对等节点会作为可选主机出现。详见 [docs/remote.md](https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/remote.md)。

## 它会接触什么

- **运行** 你已有的 `claude` 程序，在本机或你通过 SSH 添加的主机上。
- **读取** Claude Code 的登录信息（`~/.claude/.credentials.json`，或已设置的 `ANTHROPIC_API_KEY`），用来获取模型列表和套餐用量。这个令牌只会发往 `api.anthropic.com`。
- **写入** 自己的状态到 `~/.local/state/dsh-oh-my-claude/`；SSH 主机的登录令牌保存为只有你能读取的文件。CLAUDE.md、settings.json 和 MCP 服务器只在你从面板编辑时才会改动。
- **监听** 一个 Unix socket，供在 dsh 重启期间托管 Claude 的 keeper 使用。不开放 TCP 端口：插件的 HTTP 路由都在 dsh 自己的服务器里。
- **访问** `api.anthropic.com`（模型、套餐用量）、`status.anthropic.com`、`downloads.claude.ai`（CLI 的版本指针）、`registry.npmjs.org`（插件更新检查）和 `api.github.com`（仓库的 Star 数）。SSH 只连接你添加的主机。

## 不包含的内容

- dsh 的 shell 和文件工具不经过代理（后台任务用的 `bash` 除外）；Claude Code 使用自己的工具，受它自己的权限模式约束。
- 删除 dsh 会话时不会删除对应的 Claude Code 会话。

## 问题与反馈

发现 bug，或有读起来不对的地方？请在 [github.com/lcestou/dsh-oh-my-claude/issues](https://github.com/lcestou/dsh-oh-my-claude/issues) 提交 issue，附上 dsh 和 Claude Code 的版本（`dsh --version`、`claude --version`）以及你期望看到的结果。设置 → Oh My Claude → 报告问题 会替你写好这份报告。

## 许可证

[MIT](LICENSE)。

Claude、Claude Code 和 Claude spark 标志是 Anthropic, PBC 的商标。本项目是一个独立的 dsh 插件，驱动你已有的 Claude Code CLI；它并非由 Anthropic 制作、认可或支持。这里画出 spark 只是为了标明哪些会话和控件属于 Claude Code，方式与 CLI 自身的画法一致。
