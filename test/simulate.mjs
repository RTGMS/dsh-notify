/**
 * Local checks for the notification plugin, runnable without installing it:
 *
 *   node test/simulate.mjs            # drive fake session events (dry run)
 *   node test/simulate.mjs --preview  # show one real notification banner
 *
 * The simulation stubs a minimal Cordis context, so it needs no Harness boot.
 */
import { apply, buildAppleScript, clampText, normalizeConfig, notifyDesktop } from '../index.js'

const preview = process.argv.includes('--preview')

if (preview) {
  await notifyDesktop({
    title: 'DSH · 通知预览',
    subtitle: 'dsh-notify',
    body: '这条横幅来自预览命令：任务完成或需要审批时会这样提醒你。',
    sound: 'Glass',
  })
  console.log('preview notification sent (check Notification Center)')
  process.exit(0)
}

/** Minimal Cordis context: event bus + effect tracking. */
function createContext() {
  const handlers = new Map()
  const disposers = []
  const ctx = {
    logger: { log: () => {}, warn: () => {}, info: () => {} },
    sessionTitle: { get: (session) => (session.__title ? { title: session.__title } : undefined) },
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, [])
      handlers.get(name).push(handler)
      return () => {
        const list = handlers.get(name) ?? []
        handlers.set(name, list.filter((item) => item !== handler))
      }
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }
  return {
    ctx,
    emit(name, ...args) {
      for (const handler of handlers.get(name) ?? []) handler(...args)
    },
    disposeAll() {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

const output = []
const harness = createContext()
harness.ctx.logger = {
  log: (...args) => output.push(args.join(' ')),
  warn: (...args) => output.push(`WARN ${args.join(' ')}`),
  info: () => {},
}

const mainSession = {
  id: 'session-main',
  __title: '帮我重构登录模块',
  header: { cwd: '/Users/me/code/app' },
  snapshotEvents: () => [
    { type: 'turn/start', data: { turn: 1 } },
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '登录模块已经拆成三个文件，并补上了单元测试。' }] } },
    },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ],
}

const subSession = {
  id: 'session-sub',
  header: { cwd: '/Users/me/code/app', origin: 'subagent', parentSession: 'session-main' },
  snapshotEvents: () => [],
}

// A user's own fork also carries parentSession; it must still be announced.
const forkSession = {
  id: 'session-fork',
  header: { cwd: '/Users/me/code/app', parentSession: 'session-main', isSeeded: true },
  snapshotEvents: () => [{ type: 'turn/start', data: { turn: 1 } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }],
}

apply(harness.ctx, { dryRun: true, minTurnSeconds: 0 })

harness.emit('session/event', mainSession, { type: 'turn/start', data: { turn: 2 } })
harness.emit('session/event', mainSession, { type: 'approval/asked', data: { toolName: 'bash', reason: 'rm -rf build/' } })
harness.emit('session/event', mainSession, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
harness.emit('session/event', subSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

harness.emit('session/event', mainSession, { type: 'turn/start', data: { turn: 3 } })
harness.emit('session/event', mainSession, { type: 'turn/end', data: { turn: 3, reason: { kind: 'aborted' } } })
harness.emit('session/event', forkSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

harness.disposeAll()

const joined = output.join('\n')
console.log('--- dry-run output ---')
console.log(joined)

const checks = [
  ['turn/end banner rendered', joined.includes('任务已完成') && joined.includes('登录模块')],
  ['assistant excerpt used as body', joined.includes('登录模块已经拆成三个文件')],
  ['approval banner rendered', joined.includes('需要你审批') && joined.includes('bash') && joined.includes('rm -rf build/')],
  ['subagent session skipped', !joined.includes('session-sub')],
  ['aborted turn skipped', !joined.includes('第 3 轮')],
  ['forked user session announced', joined.includes('第 1 轮已完成')],
  ['apple script escapes quotes', buildAppleScript({ title: 'a"b', body: 'c\\d', sound: 'Glass' }).includes('a\\"b')],
  ['apple script keeps sound', buildAppleScript({ title: 't', body: 'b', sound: 'Glass' }).includes('sound name "Glass"')],
  ['clamp keeps budget', clampText('x'.repeat(300), 50).length === 50],
  ['clamp collapses whitespace', clampText('  a\n\n b  ', 50) === 'a b'],
  ['config overrides defaults', normalizeConfig({ onApproval: false }).onApproval === false],
  ['sound false means silent', normalizeConfig({ sound: false }).sound === ''],
  ['config survives null', normalizeConfig(null).onTurnEnd === true],
]

let failed = 0
console.log('--- assertions ---')
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed += 1
}
process.exit(failed === 0 ? 0 : 1)
