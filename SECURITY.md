# Security

## Reporting a problem

Report a security problem through GitHub's private channel at
https://github.com/lcestou/dsh-oh-my-claude/security/advisories/new, not in a public issue.
Say which plugin, dsh and Claude Code versions you ran (`dsh --version`, `claude --version`)
and what you saw. You will get a reply within a week, and a fix ships as a patch release on
the current line. Only the latest release gets fixes.

## What the plugin touches

The plugin runs the `claude` binary you already have and reads its login to fetch your model
list and plan usage. That token goes only to `api.anthropic.com`. Its own state, including the
login tokens for SSH boxes you add, lives under `~/.local/state/dsh-oh-my-claude/` in files
only your user can read. It opens no TCP port: the keeper that holds Claude across a dsh
restart listens on a Unix socket, and the HTTP routes live inside dsh's own server. Outbound
calls go to `api.anthropic.com`, `status.anthropic.com`, `downloads.claude.ai`,
`registry.npmjs.org` and `api.github.com`, and SSH only to boxes you add. The README section
"What it touches" keeps this list current.

Claude Code's permission mode defaults to following the session's access switch in dsh. A
bypass mode is never the default; a user chooses it per session or pins it in the plugin's
settings.
