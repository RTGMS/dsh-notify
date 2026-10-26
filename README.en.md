# dsh-notify

**English** | [中文](README.md)

Desktop notifications for DeepSeek Harness: get a system banner **when a task finishes** and **when a tool asks for your approval**. Host-only plugin — it subscribes to events, never writes to the session log, and leaves nothing behind when removed.

- **Turn finished** — announces the end of a top-level turn and puts a summary of the final reply in the body.
- **Approval needed** — fires the moment a tool emits `approval/asked`, while the decision is still open, so you can go click allow/deny.
- **No third-party dependencies** — just `node:child_process` calling `osascript` (macOS) or `notify-send` (Linux).

## Layout

```
dsh-notify/
├─ index.js              # the plugin (host side, plain ESM)
├─ cordis.patch.yml      # patch that inserts it into a profile + all tunables
├─ locale/{zh,en}.json   # name and description shown in the Plugins page
├─ icon.svg              # icon
└─ test/simulate.mjs     # local self-test / banner preview
```

## Requirements

- DeepSeek Harness 0.2.x (desktop app or a CLI profile; this is a profile-level bundle)
- macOS (`osascript display notification`) or Linux (`notify-send`); Windows is skipped with a warning for now
- No third-party packages — the Node runtime shipped with DSH is enough

## Install

The desktop app owns its `desktop` profile, so **do not hand-edit** `~/.dsh/profiles/desktop`. Install from the UI:

1. Open the DSH web UI and click **Plugins** in the left sidebar.
2. Click **Add plugin** → choose **Install third-party plugin**.
3. Enter the absolute path of this directory (on this machine):

   ```
   /Users/chenwenjia/code/my/dsh-notify
   ```

4. Confirm. The installer `link:`s it into the profile and enables it in the bundle list.
5. Nothing pops up after install — the plugin only speaks at turn end and at approval time.

> `link:` means a symlink, not a copy: editing `index.js` / `cordis.patch.yml` needs no reinstall — restart the app (or toggle the plugin off and on in the Plugins page) to apply.

## Verify

You can try it without installing (this really shows a banner):

```bash
cd /Users/chenwenjia/code/my/dsh-notify
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  test/simulate.mjs --preview
```

Run the logic self-test (synthetic events, no banners, 13 assertions):

```bash
cd /Users/chenwenjia/code/my/dsh-notify
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  test/simulate.mjs
```

## Configuration

Edit `config` in `cordis.patch.yml`, then restart the app:

| Field | Default | Meaning |
| --- | --- | --- |
| `onTurnEnd` | `true` | Announce the end of a turn |
| `onApproval` | `true` | Announce a pending tool approval |
| `subagents` | `false` | Also announce subagent/workflow sessions (usually noisy) |
| `minTurnSeconds` | `5` | Skip turn-end banners for turns shorter than N seconds; `0` announces every turn |
| `sound` | `Glass` | Banner sound name (macOS built-ins such as `Glass`, `Ping`, `Sosumi`); `''` for silent |
| `titlePrefix` | `DSH` | Title prefix |
| `maxBodyChars` | `180` | Maximum body length |
| `dryRun` | `false` | Log instead of showing a banner — for debugging |

Example: approvals only, silent, and still skipping short turns.

```yaml
- insert:
    - id: notify
      name: '@local/dsh-notify'
      config:
        onTurnEnd: false
        minTurnSeconds: 5
        sound: ''
```

## What the banners look like

| Moment | Title | Subtitle | Body |
| --- | --- | --- | --- |
| Turn ended (`completed`) | `DSH · 任务已完成` | Session title, or the workspace name | Plain text of the final reply, clamped to `maxBodyChars` |
| Turn failed (`error`) | `DSH · 任务出错` | same | same |
| Waiting for approval | `DSH · 需要你审批` | same | `bash 正在等待你的确认：<reason>` |

The `DSH` prefix comes from `titlePrefix`. Banner copy is Chinese by design; change the template strings in `index.js` if you want another language.

## How it works

The plugin subscribes to `session/event` on the root context:

- `turn/start` — records when the turn began;
- `turn/end` — skipped when `reason.kind` is `aborted` or `interrupted`; announced for `completed` / `error`; also skipped when the turn ran shorter than `minTurnSeconds`;
- `approval/asked` — announced immediately (before `approval/decided`);
- `session/disposed` — drops the stored timestamp.

Subagent and workflow sessions are recognised by `session.header.origin === 'subagent'` and skipped by default. A session you forked yourself is **not** a subagent (it only carries `parentSession`), so it is still announced. The handler is wrapped in try/catch, so a failed notification can never take a session down.

## Troubleshooting

1. **System Settings → Notifications**: find `DeepSeek Harness` (or `Script Editor` / `osascript`, depending on which one was granted first), allow notifications, and make sure the style is not "None".
2. Check **Focus** mode — it silences banners.
3. Open Notification Center: if history exists but no banner appeared, the banner style is usually set to "None".
4. Run the `--preview` command once. If it exits `0` and still nothing shows, it is almost always item 1 or 2.
5. To confirm the plugin is running, set `dryRun: true`: every turn end then logs a `[dsh-notify] …` line.

## Uninstall

Click **Remove** on `@local/dsh-notify` in the Plugins page. Because it was installed with `link:`, this directory stays where it is and can be reinstalled anytime; delete the directory for a full cleanup.

## Limitations

- macOS and Linux only; Windows is skipped with a warning.
- Notifications are global across top-level sessions — they do not follow which session has focus. An `onlyCwd` filter could be added to scope them to one workspace.
- It does not change the approval policy and never approves anything for you; the reminder fires between `approval/asked` and `approval/decided`.
- Banners have no action buttons: clicking one focuses Notification Center rather than the matching session.
