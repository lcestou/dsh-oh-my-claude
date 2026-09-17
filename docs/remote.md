# Remote boxes and accounts

How to run more than one login, reach more than one machine, and drive a `claude` that lives on a box with no dsh. Back to the [README](../README.md). The plugin runs Claude Code as a child of dsh, so by default everything is on the machine that runs `dsh web`; [Where things live](how-it-works.md#where-things-live) says which binary, config dir and login that is.

## Several accounts

Mount the plugin more than once in the profile's `cordis.patch.yml`, with the same `name: dsh-oh-my-claude`, distinct `id` values (the bundle's own row is `oh-my-claude`), each with its own `configDir` and a `providerId` starting with `claude-code-`. The extra row goes under `insert`; a bare `- id:` entry only overrides a row that already exists and an unknown id is silently dropped:

```yaml
- id: oh-my-claude
  config:
    configDir: ~/.claude
- insert:
    - id: oh-my-claude-work
      name: dsh-oh-my-claude
      config:
        providerId: claude-code-work
        providerName: Work
        configDir: ~/.claude-work
```

Each mount gets its own `CLAUDE_CONFIG_DIR`, state files under `~/.local/state/dsh-oh-my-claude/<providerId>/` (sessions, busy log, resume trace), and a separate row in the process registry, so the two logins never mix. In v1 the session browser, settings editor, MCP bridge, usage route and turn-status panel all belong to the default `claude-code` instance; a non-default mount logs one info line saying so.

Same box, several clients (laptop, phone, another PC on the LAN): run `dsh web` where Claude Code is logged in and open that URL from anywhere.

## Several boxes

For the Boxes list the plugin does not ssh: a wrapper named `claude` that did would run the model elsewhere while the panel still read local transcripts and settings. Instead, install dsh and this plugin on each box that has Claude Code, and list the others under Settings → Oh My Claude → Boxes (name, URL, optional dsh token). To drive one remote `claude` directly, with no dsh on the far side, see [A box over SSH](#a-box-over-ssh); that is a different trade, and its panels reach less far.

Each row is probed from this dsh: host, `claude` version, who is logged in, plugin version (a mismatch is flagged). Open jumps the browser to that box; sessions and logins stay where they are. The token is that box's dsh launch token, needed only when this browser has never logged into it; a proxy that injects the token needs none. Saved in `~/.local/state/dsh-oh-my-claude/boxes.json`, routes `GET`/`PUT /dsh-oh-my-claude/boxes` and `GET /dsh-oh-my-claude/boxes/status`, behind dsh's login.

Every row in Boxes offers Log in and Log out for that box; [Login](how-it-works.md#where-things-live) describes the flow.

## Remote through dsh's own seam

dsh separates *what runs a process* from *who asks*: `ctx.subprocess` is a seam, and a community provider can mount a remote one. With `spawn: dsh` this plugin starts `claude` through that seam instead of node's `spawn`, so a workspace that such a provider routes to another machine runs Claude Code there, with that machine's login and transcripts, and no ssh code in this plugin.

Caveats: the seam's environment is dsh's scrubbed one (credentials come from the remote login); the MCP bridge URL points at this dsh's port, which a remote process cannot reach unless forwarded, so `dshTools` is best off for such workspaces; the session browser and settings editor stay local. The seam contract is covered by `src/adapter.test.ts`; a live remote run needs such a provider mounted.

## A box over SSH

When there is no dsh on the far box and no remote subprocess provider, `sshHost` drives its `claude` from here directly. With `spawn: keeper` (the default) the far `claude` is held in a session of its own on the box, its stdin a FIFO and its stdout a file under `~/.local/state/dsh-oh-my-claude/hold/` there. A dsh restart here reattaches from the byte the last one read, and a dropped ssh reconnects without the session noticing. Nothing runs on the box but the CLI.

### Adding a box

The Boxes tab does this for you: give a box a name and `user@host` (or an `~/.ssh/config` alias) and the plugin mounts a `claude-code-<name>` instance from its own `ssh-boxes.json`, at boot and on each change, so no config edit and no restart is needed. When a box does not answer, the row says which of four things it is (name not found, unreachable, host key, key refused) and what to do about each, plus "no claude" for a box that answers but has nothing to run.

A box on a tailnet or behind WireGuard is the same box: `sshHost` takes the MagicDNS name, the Tailscale IP or the WireGuard address as it is, and the Boxes tab has Tailscale and WireGuard as box kinds. Tailscale shows whether this PC is on a tailnet and joins it from a Connect button. With Tailscale's own service the approval link opens in your browser; with a self-hosted Headscale you type its URL as the login server and, if you made one with `headscale preauthkeys create`, a pre-auth key, and it joins with no browser at all (the same `tailscale up --login-server … --authkey …` Headscale documents). Peers are then a pick. WireGuard lists the peers of any tunnel that is up, with its last handshake, and the tunnel address is the host.

By hand, mount an instance the way [Several accounts](#several-accounts) does, give it a `providerId` starting `claude-code-`, and set `sshHost` to the host:

```yaml
- name: dsh-oh-my-claude
  id: claude-nova
  config:
    providerId: claude-code-nova
    providerName: Nova
    sshHost: nova
    dshTools: false
```

### Workspaces on a box

Adding a workspace on a box goes through dsh's own sidebar "+". While at least one SSH box is saved, that button opens this plugin's copy of dsh's Select Workspace Directory dialog (`src/client/browser.tsx`, ported from dsh 0.1.5 because dsh does not export it: same header with the breadcrumb and the pencil that turns it into a typed path, the same two-pane Miller view, nested New folder, truncated and loading notices, footer bar and copy, on dsw tokens) with one addition: a box dropdown first in the footer bar, dsh's `Menu` on a selector trigger, This box by default. A remote box lists over ssh through `GET /dsh-oh-my-claude/box-dirs` and creates folders through its POST; Open on a remote path pins a dsh workspace to it through `POST /dsh-oh-my-claude/remote-workspaces`. With no SSH box saved, dsh's own dialog is untouched.

A remote workspace is two records. dsh's own workspace registry holds the workspace, pinned to an empty stand-in folder under the plugin's state dir (`remote-workspaces/<box>__<path>`), and that record is what the sidebar draws. The plugin's `remote-workspaces.json` holds the rest: which box and which folder there the stand-in points at. The registry decides what exists. The file is checked against it when the registry mounts and every time the Settings card reads it, and a row whose workspace dsh no longer has is dropped with its stand-in folder, so a workspace deleted from the sidebar's own menu is gone from the card too. The card follows dsh's workspace list while it is open, so an add, a delete or a box removal shows without a reload.

Removing a box removes the workspaces pinned to it, and its row says how many before the click. Their sessions keep their logs, as dsh's delete leaves them, and come back under the workspace if the same folder on the same box is pinned again. A workspace dsh refuses to delete stays in the card with the error, since the sidebar still lists it.

dsh's Files panel lists the stand-in folder, which is empty by design. The session's files are on the box.

A file or image attached to a message in a session that runs on a box is copied there first, over the same ssh, into `~/.local/state/dsh-oh-my-claude/attachments/` on the box. dsh saves an attachment on this PC and writes that path into the `[File …]` handle Claude reads; the plugin swaps in the path on the box, and does the same for the saved copy an image's note names. A file that cannot be copied keeps its original handle, and Claude reports the path as unreadable; an image that cannot be copied still reaches Claude inline, with no saved-copy path to read it from again. The copy on the box takes its name only once it holds every byte, so a transfer cut short leaves nothing behind under that name. Copies on the box are never cleaned up by the plugin.

### What runs where

Every turn runs `ssh <host> claude -p --input-format stream-json …`; the remote shell inherits none of this box's environment, so the invocation carries the workspace directory and the CLI's env with it, and the stream-json wire flows through the pipe untouched, so translator, approvals and control requests all behave as if local.

The far side uses its own `~/.claude`, so log in there (`ssh <host>`, then `claude auth login` in that terminal; it needs a browser), or use Log in on the box's row. The status and diagnostics panels probe over the same ssh and report that box's binary, version and login, not this one's, and they follow the *session's* mount, not whichever instance registered the routes: pick a box's model in the picker and Diagnostics (including its `claude doctor` button) reports that box from the moment the session exists, before any prompt. It resolves the session's provider from dsh's own per-session model directory, since a session header carries no provider and a remote workspace path can equal a local one.

A box's settings files are read and written over the same ssh (`src/remote-fs.ts`): the diagnostics config-file list, the settings editor, the scope list, the plugin list, the feature switches and every Tune row act on that box's `~/.claude/settings.json`. The Instructions tab walks the same ssh: the CLAUDE.md list, the `@` imports it follows and the editor behind a row all read that box's disk, from its own `$HOME`. A remote read answers the file's mtime and its text in one round trip, and distinguishes a missing file from an unreachable box; a remote write creates the parent, keeps a `.bak` and lands through a temp file, so a dropped connection cannot leave half a settings file behind. `homeAt` asks the box for its `$HOME` rather than assuming this PC's, since the account there is usually a different one.

What does not cross yet: keeper survival (an ssh instance always spawns node-style, so a dsh restart ends its turns and resumes them with `--resume` like `spawn: node`), the dsh MCP bridge (its URL is this box's port), and the tabs still keyed to this box's disk (Browser, Memory, Rewind, and the workspace diff). SSH auth is `BatchMode` only, so a working key or agent must already reach the host. `shq`, `sshArgs`, `sshInvocation` and `sshSpawner` are in `src/process.ts`, covered by `src/ssh.test.ts`.
