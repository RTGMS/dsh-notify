/**
 * DSH Notify — macOS/Linux desktop notifications for DeepSeek Harness.
 *
 * Two moments are announced:
 *  - a top-level turn reaches `turn/end` (the agent finished answering);
 *  - a tool asks for approval (`approval/asked`, appended before the question
 *    blocks the turn, so the banner arrives while the decision is still open).
 *
 * The plugin is Host-only: it subscribes to `session/event` on the root
 * context and shells out to `osascript` (macOS) or `notify-send` (Linux).
 * Nothing is written into the session log.
 *
 * @module @local/dsh-notify
 */

import { execFile } from 'node:child_process'
import { basename } from 'node:path'

/** Cordis function-plugin name. */
export const name = 'notify'

/** Defaults for every tunable; `cordis.patch.yml` config overrides them. */
const DEFAULTS = Object.freeze({
  /** Announce a finished top-level turn. */
  onTurnEnd: true,
  /** Announce a pending tool approval. */
  onApproval: true,
  /** Also announce sessions owned by subagents/workflows. */
  subagents: false,
  /** Skip turn-end banners for turns shorter than this many seconds. */
  minTurnSeconds: 5,
  /** macOS sound name (`Glass`, `Ping`, …) or an empty string for silence. */
  sound: 'Glass',
  /** Prefix for the banner title. */
  titlePrefix: 'DSH',
  /** Hard cap for the body text. */
  maxBodyChars: 180,
})

/** Escape a string for an AppleScript double-quoted literal. */
export function escapeAppleScript(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]+/g, ' ')
}

/** Clamp one line of text to a character budget, appending an ellipsis. */
export function clampText(value, maxChars) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

/** Normalize the raw patch config into complete, typed settings. */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const pick = (key, fallback) => (input[key] === undefined ? fallback : input[key])
  const number = (key, fallback) => {
    const value = Number(pick(key, fallback))
    return Number.isFinite(value) && value >= 0 ? value : fallback
  }
  const rawSound = pick('sound', DEFAULTS.sound)
  return {
    onTurnEnd: Boolean(pick('onTurnEnd', DEFAULTS.onTurnEnd)),
    onApproval: Boolean(pick('onApproval', DEFAULTS.onApproval)),
    subagents: Boolean(pick('subagents', DEFAULTS.subagents)),
    minTurnSeconds: number('minTurnSeconds', DEFAULTS.minTurnSeconds),
    sound: rawSound === false || rawSound === null
      ? ''
      : typeof rawSound === 'string'
        ? rawSound.trim()
        : DEFAULTS.sound,
    titlePrefix: String(pick('titlePrefix', DEFAULTS.titlePrefix)).trim() || DEFAULTS.titlePrefix,
    maxBodyChars: Math.max(20, Math.round(number('maxBodyChars', DEFAULTS.maxBodyChars))),
    /** Test hook: log instead of shelling out. */
    dryRun: Boolean(pick('dryRun', false)),
  }
}

/** Build the AppleScript one-liner for one banner. */
export function buildAppleScript({ title, subtitle, body, sound }) {
  const parts = [`display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`]
  if (subtitle) parts.push(`subtitle "${escapeAppleScript(subtitle)}"`)
  if (sound && /^[A-Za-z][A-Za-z0-9 ]{0,40}$/.test(sound)) parts.push(`sound name "${sound}"`)
  return parts.join(' ')
}

/**
 * Show one desktop notification.
 * @param {object} banner - `{ title, subtitle, body, sound }`.
 * @param {object} [options] - `{ dryRun, logger }`.
 * @returns {Promise<void>} resolves after the shell command settles or fails.
 */
export function notifyDesktop(banner, options = {}) {
  const logger = options.logger ?? console
  if (options.dryRun) {
    logger.log('[dsh-notify]', banner.title, '|', banner.subtitle ?? '', '|', banner.body)
    return Promise.resolve()
  }
  const platform = options.platform ?? process.platform
  return new Promise((resolve) => {
    try {
      if (platform === 'darwin') {
        execFile('/usr/bin/osascript', ['-e', buildAppleScript(banner)], { timeout: 5000 }, (error) => {
          if (error) logger.warn?.('[dsh-notify] notification failed:', error.message)
          resolve()
        })
        return
      }
      if (platform === 'linux') {
        const args = ['--app-name=DeepSeek Harness', banner.title]
        if (banner.body) args.push(banner.body)
        execFile('notify-send', args, { timeout: 5000 }, (error) => {
          if (error) logger.warn?.('[dsh-notify] notification failed:', error.message)
          resolve()
        })
        return
      }
      logger.warn?.(`[dsh-notify] unsupported platform "${platform}"; notifications are skipped`)
      resolve()
    } catch (error) {
      logger.warn?.('[dsh-notify] notification failed:', error?.message ?? error)
      resolve()
    }
  })
}

/** Whether one session belongs to a subagent/workflow rather than the user. */
export function isSubagentSession(session) {
  const header = session?.header
  if (!header || typeof header !== 'object') return false
  // `parentSession` alone is not enough: a user's own fork carries it too.
  return header.origin === 'subagent'
}

/** Latest title recorded in the session log, or an empty string. */
export function sessionTitleOf(session, ctx) {
  try {
    const snapshot = ctx?.sessionTitle?.get?.(session)
    if (snapshot && typeof snapshot.title === 'string' && snapshot.title.trim()) return snapshot.title.trim()
  } catch {
    // The title service is optional; fall through to the log scan.
  }
  try {
    const events = session.snapshotEvents?.() ?? []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.trim()) {
        return event.data.title.trim()
      }
    }
  } catch {
    // A disposed session can refuse reads; the cwd fallback still applies.
  }
  return ''
}

/** Working-directory label used when a session has no title yet. */
export function workspaceLabel(session) {
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || !cwd) return ''
  return basename(cwd) || cwd
}

/** Final assistant text of the turn that just ended, for the banner body. */
export function lastAssistantText(session) {
  try {
    const events = session.snapshotEvents?.() ?? []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type === 'turn/start') break
      if (event?.type === 'assistant/message') {
        const content = event.data?.message?.content
        if (!Array.isArray(content)) continue
        const text = content
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join(' ')
        if (text.trim()) return text.trim()
      }
    }
  } catch {
    // Reading a disposed session is allowed to fail; the body then stays generic.
  }
  return ''
}

/** Turn-end reason kind to a short human label. */
function turnEndLabel(reason) {
  switch (reason?.kind) {
    case 'completed':
      return '已完成'
    case 'error':
      return '出错'
    case 'aborted':
      return '已中止'
    case 'interrupted':
      return '已中断'
    default:
      return '已结束'
  }
}

/**
 * Cordis entry point.
 * @param {object} ctx - plugin context.
 * @param {object} [rawConfig] - row config from `cordis.patch.yml`.
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const turns = new Map()
  const log = ctx?.logger ?? console

  const send = (banner) => {
    void notifyDesktop(banner, { dryRun: config.dryRun, logger: log })
  }

  const onSessionEvent = (session, event) => {
    try {
      if (!event || typeof event.type !== 'string') return
      if (!config.subagents && isSubagentSession(session)) return

      switch (event.type) {
        case 'turn/start': {
          turns.set(session.id, Date.now())
          return
        }
        case 'turn/end': {
          const startedAt = turns.get(session.id)
          turns.delete(session.id)
          if (!config.onTurnEnd) return
          const reason = event.data?.reason
          if (reason?.kind === 'aborted' || reason?.kind === 'interrupted') return
          if (startedAt !== undefined && (Date.now() - startedAt) / 1000 < config.minTurnSeconds) return

          const label = turnEndLabel(reason)
          const excerpt = lastAssistantText(session)
          const body = excerpt
            ? clampText(excerpt, config.maxBodyChars)
            : `第 ${event.data?.turn ?? '?'} 轮${label}`
          send({
            title: `${config.titlePrefix} · 任务${label}`,
            subtitle: sessionTitleOf(session, ctx) || workspaceLabel(session),
            body,
            sound: config.sound,
          })
          return
        }
        case 'approval/asked': {
          if (!config.onApproval) return
          const toolName = event.data?.toolName ? String(event.data.toolName) : '某个工具'
          const reason = typeof event.data?.reason === 'string' ? event.data.reason : ''
          send({
            title: `${config.titlePrefix} · 需要你审批`,
            subtitle: sessionTitleOf(session, ctx) || workspaceLabel(session),
            body: clampText(`${toolName} 正在等待你的确认${reason ? `：${reason}` : ''}`, config.maxBodyChars),
            sound: config.sound,
          })
          return
        }
        default:
      }
    } catch (error) {
      log.warn?.('[dsh-notify] handler failed:', error?.message ?? error)
    }
  }

  ctx.effect(() => ctx.on('session/event', onSessionEvent))
  ctx.effect(() => ctx.on('session/disposed', (session) => {
    turns.delete(session?.id)
  }))

}
