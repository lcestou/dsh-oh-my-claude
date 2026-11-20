// Strings for the accounts under This box in Settings → Boxes (src/client/accounts.tsx).

/** English. */
export const en = {
  "accounts.kind": "account",
  "accounts.addHint":
    "Another Claude login on this box, kept in its own config dir. It shows in the model picker under its name.",
  "accounts.addAccount": "Add account…",
  "accounts.nameLabel": "Account name",
  "accounts.namePlaceholder": "Name, such as Work",
  "accounts.dirLabel": "Config dir",
  "accounts.dirPlaceholder": "~/.claude-work",
  "accounts.formHint":
    "Log in from the new row once it is added. An empty config dir means {dir}. A folder that already holds a Claude Code login keeps it.",
  "accounts.formHintNoName":
    "Log in from the new row once it is added. An empty config dir means ~/.claude- and the name.",
  "accounts.notMounted": "not mounted: {provider} is already set up in cordis.patch.yml",
  "accounts.fromProfile": "Set up by hand in dsh's cordis.patch.yml. Remove it there.",
  "accounts.logOutAria":
    "Log out {name}: log this account's Claude Code out and stop its running sessions",
  "accounts.removeAria":
    "Remove {name}: stop its running sessions. Its login and files in {dir} stay.",
} as const;

/** Chinese, one per English key. */
export const zh = {
  "accounts.kind": "账号",
  "accounts.addHint":
    "本机上的另一个 Claude 登录，使用独立的配置目录，并以其名称出现在模型选择器中。",
  "accounts.addAccount": "添加账号…",
  "accounts.nameLabel": "账号名称",
  "accounts.namePlaceholder": "名称，例如 Work",
  "accounts.dirLabel": "配置目录",
  "accounts.dirPlaceholder": "~/.claude-work",
  "accounts.formHint":
    "添加后在新的一行中登录。配置目录留空即为 {dir}。已有 Claude Code 登录的文件夹会保留该登录。",
  "accounts.formHintNoName": "添加后在新的一行中登录。配置目录留空即为 ~/.claude- 加上名称。",
  "accounts.notMounted": "未挂载：{provider} 已在 cordis.patch.yml 中设置",
  "accounts.fromProfile": "在 dsh 的 cordis.patch.yml 中手动设置，需在那里移除。",
  "accounts.logOutAria": "退出登录 {name}：让此账号的 Claude Code 退出登录并停止其正在运行的会话",
  "accounts.removeAria": "移除 {name}：停止其正在运行的会话。{dir} 中的登录和文件会保留。",
} as const;
