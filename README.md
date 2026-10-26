# dsh-notify

[English](README.en.md) | **中文**

DeepSeek Harness 的桌面通知插件：**任务跑完**、**工具请求你审批**时，弹一条系统横幅。纯 Host 插件，只订阅事件，不写会话日志，卸载无残留。

- **任务完成** — 顶层会话跑完一轮时提醒，正文尽量带上最后一条回复的摘要。
- **需要审批** — 工具发起 `approval/asked` 时立刻提醒；这时审批还开着，正好去点允许/拒绝。
- **零第三方依赖** — 只用 `node:child_process` 调 `osascript`（macOS）或 `notify-send`（Linux）。

## 目录结构

```
dsh-notify/
├─ index.js              # 插件本体（Host，纯 ESM）
├─ cordis.patch.yml      # 插入 profile 的补丁 + 全部可调配置
├─ locale/{zh,en}.json   # 插件页显示的名称与描述
├─ icon.svg              # 图标
└─ test/simulate.mjs     # 本地自测 / 通知预览
```

## 环境要求

- DeepSeek Harness 0.2.x（桌面版或 CLI profile 均可；本插件是 profile 级 bundle）
- macOS（`osascript display notification`）或 Linux（`notify-send`）；Windows 目前跳过并记一条 warning
- 无第三方依赖，用 DSH 自带 Node 运行即可

## 安装

桌面应用的 `desktop` profile 归应用托管，**不要手工改** `~/.dsh/profiles/desktop`，从界面装：

1. DSH Web 界面 → 左侧 **插件**（Plugins）。
2. **添加插件** → 下拉选 **安装第三方插件**。
3. 填本目录的绝对路径（本机是）：

   ```
   /Users/chenwenjia/code/my/dsh-notify
   ```

4. 确认安装：安装器会把它 `link:` 进 profile，并在 bundle 列表里启用。
5. 装好后不会弹横幅——插件只在「任务完成」和「等待审批」两个时刻响。

> `link:` 是链接而非复制，之后改 `index.js` / `cordis.patch.yml` 无需重装，重启应用（或在插件页关掉再打开）即生效。

## 验证

不安装也能先看效果（会真弹一条横幅）：

```bash
cd /Users/chenwenjia/code/my/dsh-notify
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  test/simulate.mjs --preview
```

跑逻辑自测（假事件，不弹窗，输出 13 条断言）：

```bash
cd /Users/chenwenjia/code/my/dsh-notify
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  test/simulate.mjs
```

## 配置

改 `cordis.patch.yml` 里的 `config`，重启应用生效：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `onTurnEnd` | `true` | 一轮结束时提醒 |
| `onApproval` | `true` | 工具请求审批时提醒 |
| `subagents` | `false` | 是否也提醒子代理/工作流会话（通常很吵） |
| `minTurnSeconds` | `5` | 短于 N 秒的轮次不提醒；`0` 表示每轮都提醒 |
| `sound` | `Glass` | 通知声音名（macOS 内置如 `Glass`、`Ping`、`Sosumi`）；`''` 为静音 |
| `titlePrefix` | `DSH` | 横幅标题前缀 |
| `maxBodyChars` | `180` | 正文最大字数 |
| `dryRun` | `false` | 只写日志不弹窗，排查用 |

示例：只在审批时提醒、静音、且过滤 5 秒内的短轮次。

```yaml
- insert:
    - id: notify
      name: '@local/dsh-notify'
      config:
        onTurnEnd: false
        minTurnSeconds: 5
        sound: ''
```

## 通知长什么样

| 时机 | 标题 | 副标题 | 正文 |
| --- | --- | --- | --- |
| 一轮结束（`completed`） | `DSH · 任务已完成` | 会话标题，取不到则用工作区名 | 最后一条回复的纯文本，截到 `maxBodyChars` |
| 一轮出错（`error`） | `DSH · 任务出错` | 同上 | 同上 |
| 等待审批 | `DSH · 需要你审批` | 同上 | `bash 正在等待你的确认：<原因>` |

标题里的 `DSH` 来自 `titlePrefix`。

## 工作原理

宿主侧订阅根上下文的 `session/event`：

- `turn/start` — 记下该会话本轮的开始时间；
- `turn/end` — `reason.kind` 为 `aborted` / `interrupted` 时跳过，`completed` / `error` 正常提醒；耗时短于 `minTurnSeconds` 也跳过；
- `approval/asked` — 立即提醒（此时 `approval/decided` 还没发生）；
- `session/disposed` — 清掉该会话的时间戳。

子代理/工作流会话靠 `session.header.origin === 'subagent'` 识别，默认跳过；**用户自己 fork 的会话**不算子代理（它只是带 `parentSession`），仍会提醒。处理函数全程 try/catch，插件不会因为通知失败而拖垮会话。

## 收不到通知时

1. **系统设置 → 通知**，找到 `DeepSeek Harness`（或首次授权时的 `Script Editor` / `osascript`），确认允许通知且样式不是「无」。
2. 检查是否开了**专注模式**（Focus），它会静音横幅。
3. 打开通知中心看有没有历史：有历史无横幅，通常是横幅样式被设成「无」。
4. 手动跑一次 `--preview`：命令 `exit=0` 却没横幅，基本就是第 1/2 条的权限或专注模式问题。
5. 想在会话日志里确认插件在跑：把 `dryRun` 设为 `true`，每轮结束会有一条 `[dsh-notify] …` 日志。

## 卸载

插件页里对 `@local/dsh-notify` 点 **移除**（Remove）。因为是 `link:` 安装，本目录仍保留，可随时再装。想彻底清理就删掉本目录。

## 边界

- 只支持 macOS 和 Linux；Windows 会跳过并写 warning。
- 通知对所有顶层会话生效，不区分当前聚焦哪一个；只想收某个工作区的提醒，可以加 `onlyCwd` 过滤。
- 不改变审批策略，也不替你点「允许」；提醒只发生在 `approval/asked` 之后、`approval/decided` 之前。
- 通知没有动作按钮：点横幅只会聚焦通知中心，不会跳到对应会话。
