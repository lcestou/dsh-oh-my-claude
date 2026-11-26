// Strings for the test gate: its Settings row (src/client/test-gate-settings.tsx) and its card
// above the composer (src/client/test-gate-card.tsx).

/** English. */
export const en = {
  "testGate.title": "Test gate",
  "testGate.desc":
    "Before Claude ends a turn in this workspace, run its tests. If they fail, Claude keeps fixing, up to the number of tries you set. Runs only in Auto or Bypass mode. It catches mistakes; it does not stop Claude from changing the tests.",
  "testGate.workspace": "Workspace: {path}",
  "testGate.noSession": "Open a session in a workspace to set its test command.",
  "testGate.remote": "The test gate runs only for workspaces on this box.",
  "testGate.command": "Test command",
  "testGate.trust":
    "Runs on this box as you, with your permissions, in the workspace folder. Only enter a command you trust.",
  "testGate.suggested": "Suggested from the project files: {command}",
  "testGate.useSuggested": "Use it",
  "testGate.tries": "Tries",
  "testGate.timeout": "Stop the run after",
  "testGate.saved": "Saved. It applies from this workspace's next turn.",
  "testGate.saveFailed": "Could not save. Reload Settings and try again.",
  "testGate.held":
    "Tests not run: the test gate runs only in Auto or Bypass mode, where Claude runs commands without asking.",
  "testGate.running": "Running tests: {command}",
  "testGate.fixing": "Tests failed. Claude is fixing them ({attempt}/{tries}).",
  "testGate.passedOne": "Tests pass after 1 fix.",
  "testGate.passedOther": "Tests pass after {n} fixes.",
  "testGate.gaveUp": "Tests still fail after {tries} tries. The turn ended.",
  "testGate.timedOut": "The tests took too long and were stopped. The turn ended without a check.",
  "testGate.broken": "The test command could not start (exit {code}). Check it in Settings.",
  "testGate.showOutput": "Show output",
  "testGate.hideOutput": "Hide output",
  "testGate.rewind": "Rewind this turn",
  "testGate.dismiss": "Dismiss the test result",
};

/** Chinese. */
export const zh = {
  "testGate.title": "测试门禁",
  "testGate.desc":
    "Claude 在此工作区结束一轮前先运行测试。测试失败时，Claude 会继续修复，最多尝试你设定的次数。仅在“自动”或“绕过”模式下运行。它用来发现错误，不能阻止 Claude 修改测试。",
  "testGate.workspace": "工作区：{path}",
  "testGate.noSession": "先在某个工作区打开会话，再设置它的测试命令。",
  "testGate.remote": "测试门禁只适用于本机上的工作区。",
  "testGate.command": "测试命令",
  "testGate.trust": "以你的身份和权限在工作区目录中运行。只输入你信任的命令。",
  "testGate.suggested": "根据项目文件推荐：{command}",
  "testGate.useSuggested": "使用",
  "testGate.tries": "尝试次数",
  "testGate.timeout": "运行超时",
  "testGate.saved": "已保存。从此工作区的下一轮开始生效。",
  "testGate.saveFailed": "保存失败，请重新打开设置后重试。",
  "testGate.held":
    "未运行测试：测试门禁只在“自动”或“绕过”模式下运行，此时 Claude 无需询问即可运行命令。",
  "testGate.running": "正在运行测试：{command}",
  "testGate.fixing": "测试失败，Claude 正在修复（{attempt}/{tries}）。",
  "testGate.passedOne": "修复 1 次后测试通过。",
  "testGate.passedOther": "修复 {n} 次后测试通过。",
  "testGate.gaveUp": "尝试 {tries} 次后测试仍未通过，本轮已结束。",
  "testGate.timedOut": "测试运行太久，已被停止。本轮未经检查即结束。",
  "testGate.broken": "测试命令无法启动（退出码 {code}）。请在设置中检查。",
  "testGate.showOutput": "显示输出",
  "testGate.hideOutput": "隐藏输出",
  "testGate.rewind": "回退本轮",
  "testGate.dismiss": "关闭测试结果",
};
