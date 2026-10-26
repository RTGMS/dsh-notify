# dsh-notify

任务完成或工具请求审批时，让 DeepSeek Harness 给你弹一条 macOS 系统通知。

- **任务完成**：顶层会话（不是子代理）跑完一轮 `turn/end` 时提醒，正文尽量带上最后一条回复的摘要。
- **需要审批**：工具发起 `approval/asked` 时立刻提醒（这时审批还没被处理，正好去点允许/拒绝）。
- **不写会话日志**：只订阅事件，纯 Host 插件；卸载后无残留。

```
dsh-notify/
├─ index.js            # 插件本体（Host，纯 ESM，无第三方依赖）
├─ cordis.patch.yml    # 插入到当前 profile 的补丁 + 可调配置
├─ locale/{zh,en}.json # 插件市场/设置页显示的名称与描述
├─ icon.svg            # 图标
└─ test/simulate.mjs   # 不安装也能跑的本地自测 / 通知预览
```

## 安装

当前 profile 是桌面应用托管的 `desktop`，不要手工改 `~/.dsh/profiles/desktop`；用界面安装：

1. 打开 DSH Web 界面，左侧边栏点 **插件**（Plugins）。
2. 点 **添加插件** → 下拉里的 **安装第三方插件**。
3. 在输入框里填本目录的绝对路径：

   ```
   /Users/chenwenjia/code/my/dsh-notify
   ```

4. 确认安装。安装器会把它 `link:` 进 profile，并在 bundle 列表里勾选启用。
5. 启用后不会弹任何横幅（插件只在「任务完成」和「等待审批」两个时刻提醒）。

> 本地目录安装是链接而不是复制，所以以后改 `index.js` / `cordis.patch.yml` 不用重新安装；重启应用（或在插件页关掉再打开）即可生效。

## 验证

不安装也能先看效果（会用真实的 `osascript` 弹一条通知）：

```bash
cd /Users/chenwenjia/code/my/dsh-notify
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  test/simulate.mjs --preview
```

跑逻辑自测（假事件、不弹窗）：

```bash
cd /Users/chenwenjia/code/my/dsh-notify
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  test/simulate.mjs
```

## 配置

编辑 `cordis.patch.yml` 里的 `config`，重启应用后生效：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `onTurnEnd` | `true` | 一轮结束时提醒 |
| `onApproval` | `true` | 工具请求审批时提醒 |
| `subagents` | `false` | 是否也提醒子代理/工作流会话（通常会很吵） |
| `minTurnSeconds` | `5` | 短于 N 秒的轮次不提醒；设成 `0` 则每轮都提醒 |
| `sound` | `Glass` | 通知声音名（macOS 内置如 `Glass`、`Ping`、`Sosumi`）；设为 `''` 静音 |
| `titlePrefix` | `DSH` | 标题前缀 |
| `maxBodyChars` | `180` | 正文最大字数 |

示例：只在审批时提醒、静音、且过滤 5 秒内的短轮次：

```yaml
- insert:
    - id: notify
      name: '@local/dsh-notify'
      config:
        onTurnEnd: false
        minTurnSeconds: 5
        sound: ''
```

设置 `dryRun: true` 时只写 `console` 日志、不弹窗，便于排查。

## 收不到通知时

1. **系统设置 → 通知**，找到 `DeepSeek Harness`（或 `Script Editor` / `osascript`），确认允许通知、且不是「关闭」。
2. 检查是否开了**专注模式**（Focus），横幅会被静音。
3. 通知中心里有没有？有历史没横幅，通常是横幅样式被设成了「无」。
4. 手动跑一次预览命令，终端有 `exit=0` 但没横幅，基本就是上面 1/2 的权限或专注模式问题。

## 卸载

插件页里对该 bundle 点 **移除**（Remove）；因为是 `link:` 安装，移除后本目录仍然保留，可随时再装。

## 说明与边界

- 只支持 macOS（`osascript`）和 Linux（`notify-send`）；Windows 会跳过并写一条 warning。
- 通知对所有顶层会话生效，不区分当前聚焦的是哪个会话；如果只想要某个工作区，可以告诉我再加 `onlyCwd` 过滤。
- 不改变审批策略，也不代替你点「允许」；提醒只发生在 `approval/asked` 落日志之后、`approval/decided` 之前。
