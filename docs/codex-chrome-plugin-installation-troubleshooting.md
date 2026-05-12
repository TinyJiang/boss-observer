# Codex Desktop Chrome 插件安装与排障记录

## 1. 背景

这份记录沉淀本机 Codex Desktop 中 `@chrome` 插件的安装和排障经验。

本次遇到的问题不是单点故障，而是多段链路叠加：

- Codex 插件弹窗曾出现 `Could not load this plugin right now`。
- Chrome 扩展曾显示 `Disconnected`。
- 新开 Codex session 后仍看不到 `@chrome`。
- 后续 `@chrome ping` 能识别插件，但失败于 `node_repl` 不可用。
- 最终 `node_repl` 可用后，Chrome 连接仍超时。

最终结论：

- Chrome 扩展和 native host 只是基础链路。
- 当前环境还需要显式启用 `node_repl` MCP。
- `browser-client.mjs` 初始化时会触发 ambient network 请求；本机访问 `chatgpt.com/backend-api` 会遇到 Cloudflare/403，导致 `@chrome` 初始化卡住。
- 固定修复是给 `NODE_REPL_REQUEST_META` 增加 `x-codex-browser-use-disable-ambient-network=true`。

## 2. 最终可用配置

`~/.codex/config.toml` 中需要保留以下关键配置。

### 2.1 feature flags

```toml
[features]
browser_use_external = true
browser_use = true
apps = true
plugins = true
computer_use = true
```

### 2.2 本地 Chrome marketplace

本次不要继续依赖 `chrome@openai-bundled`。

原因是 Codex Desktop 当前运行时写入的 `openai-bundled` marketplace 只包含少量内置插件，曾自动移除手动加入的 `chrome@openai-bundled` 和 `browser-use@openai-bundled`。

改用本地 marketplace：

```toml
[marketplaces.chrome-local]
source_type = "local"
source = "/Users/tiny/.codex/plugins/local/chrome-local"

[plugins."browser-use@chrome-local"]
enabled = true

[plugins."chrome@chrome-local"]
enabled = true
```

对应文件路径：

```text
/Users/tiny/.codex/plugins/local/chrome-local/plugins/chrome
/Users/tiny/.codex/plugins/local/chrome-local/plugins/browser-use
/Users/tiny/.codex/plugins/cache/chrome-local/chrome/0.1.7
/Users/tiny/.codex/plugins/cache/chrome-local/browser-use/0.1.0-alpha2
```

`latest` symlink 应指向当前 Chrome 插件版本：

```text
/Users/tiny/.codex/plugins/cache/chrome-local/chrome/latest -> /Users/tiny/.codex/plugins/cache/chrome-local/chrome/0.1.7
```

## 3. Chrome 扩展与 native host

Chrome Web Store 扩展 ID：

```text
hehggadaopoacecdllhhajmbjkdcmajg
```

native host name：

```text
com.openai.codexextension
```

native host manifest 路径：

```text
/Users/tiny/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openai.codexextension.json
```

本次最终 manifest 指向本地 marketplace cache：

```json
{
  "name": "com.openai.codexextension",
  "description": "Codex chrome native messaging host",
  "type": "stdio",
  "path": "/Users/tiny/.codex/plugins/cache/chrome-local/chrome/latest/extension-host/macos/arm64/extension-host",
  "allowed_origins": [
    "chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/"
  ]
}
```

检查扩展是否已安装并启用：

```bash
node /Users/tiny/.codex/plugins/cache/chrome-local/chrome/0.1.7/scripts/check-extension-installed.js --json
```

成功关键字段：

```json
{
  "installed": true,
  "registered": true,
  "enabled": true,
  "disabled": false
}
```

检查 native host manifest：

```bash
node /Users/tiny/.codex/plugins/cache/chrome-local/chrome/0.1.7/scripts/check-native-host-manifest.js --json
```

成功关键字段：

```json
{
  "exists": true,
  "nameMatches": true,
  "hasExpectedOrigin": true,
  "correct": true,
  "problem": null
}
```

拉起同一 Chrome profile 的窗口：

```bash
node /Users/tiny/.codex/plugins/cache/chrome-local/chrome/0.1.7/scripts/open-chrome-window.js
```

确认 native host 进程：

```bash
pgrep -fl 'extension-host|com.openai.codexextension|hehggadaopoacecdllhhajmbjkdcmajg'
```

成功时应看到类似：

```text
/Users/tiny/.codex/plugins/cache/chrome-local/chrome/latest/extension-host/macos/arm64/extension-host chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/
```

## 4. `node_repl` MCP

`@chrome` 插件依赖 `node_repl` 执行 `browser-client.mjs`。

如果 `@chrome ping` 报：

```text
Chrome plugin ping failed: the required node_repl execution tool is not available in this session
```

说明 Chrome 插件已经被识别，但 MCP 工具缺失。

需要在 `~/.codex/config.toml` 中添加：

```toml
[mcp_servers.node_repl]
command = "/Applications/Codex.app/Contents/Resources/node_repl"
args = []
startup_timeout_sec = 120

[mcp_servers.node_repl.env]
NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = "10000"
NODE_REPL_NODE_PATH = "/Applications/Codex.app/Contents/Resources/node"
NODE_REPL_NODE_MODULE_DIRS = ""
CODEX_HOME = "/Users/tiny/.codex"
CODEX_CLI_PATH = "/Applications/Codex.app/Contents/Resources/codex"
NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S = "9990b9b3defcd92659e0d88c4cf847d97c64c0af047c4a24266821711c24749e"
NODE_REPL_BROWSER_CLIENT_MARKETPLACE_NAME = "chrome-local"
NODE_REPL_REQUEST_META = "{\"x-codex-browser-use-available-backends\":[\"chrome\",\"iab\"],\"x-codex-browser-use-disable-ambient-network\":true}"
```

检查 MCP 是否启用：

```bash
/Applications/Codex.app/Contents/Resources/codex mcp list
```

应能看到 `node_repl` 为 `enabled`。

## 5. 本次最关键的新问题

在 native host、Chrome 扩展、`node_repl` 都正常后，`@chrome ping` 仍可能超时。

本次定位到的原因：

- `browser-client.mjs` 可以正常导入。
- native pipe 可以直接连到 Chrome extension socket。
- 最小 `getInfo` 握手可以返回 Chrome 扩展信息。
- 真正卡住的是 `setupAtlasRuntime()`。
- 该初始化会启动 Sentry/Statsig/`/backend-api/me` 这类 ambient network 请求。
- 本机访问 `chatgpt.com/backend-api` 会返回 Cloudflare/403 页面，导致初始化无法顺利完成。

固定方式是打开禁用 ambient network 的请求元数据：

```toml
NODE_REPL_REQUEST_META = "{\"x-codex-browser-use-available-backends\":[\"chrome\",\"iab\"],\"x-codex-browser-use-disable-ambient-network\":true}"
```

这个配置是本次最终让 `@chrome ping` 成功的关键。

## 6. 验证命令

验证新 prompt 是否能看到 Chrome 插件和 skill：

```bash
/Applications/Codex.app/Contents/Resources/codex debug prompt-input '@chrome ping' 2>&1 | rg -n 'Available plugins|Chrome|chrome@chrome-local|Browser|browser-use@chrome-local|skills/chrome|skills/browser|failed to load plugin'
```

成功时应出现：

```text
Available plugins
Chrome
chrome:Chrome
browser-use:browser
```

验证 `@chrome` 真实可用：

```bash
/Applications/Codex.app/Contents/Resources/codex exec --skip-git-repo-check -C /Users/tiny/work/projects/boss-observer '@chrome ping'
```

本次最终成功输出：

```text
Chrome 插件连接正常。当前能读取 Chrome 标签页，检测到 8 个打开的标签页。
```

## 7. 排障顺序

以后 `@chrome` 不可用时，按这个顺序排查：

1. 检查 `~/.codex/config.toml` 是否启用 `browser_use`、`browser_use_external`、`plugins`。
2. 检查 `chrome-local` marketplace 是否存在并启用 `browser-use@chrome-local` 和 `chrome@chrome-local`。
3. 检查缓存路径 `/Users/tiny/.codex/plugins/cache/chrome-local/chrome/0.1.7` 是否存在。
4. 检查 `latest` symlink 是否指向当前版本。
5. 跑 `check-extension-installed.js --json`，确认 Chrome 扩展 installed/enabled。
6. 跑 `check-native-host-manifest.js --json`，确认 manifest `correct: true`。
7. 用 `open-chrome-window.js` 打开 `Default` profile，让扩展重新连接 native host。
8. 用 `pgrep -fl extension-host` 确认 native host 进程已启动，且路径是 `chrome-local`。
9. 用 `codex mcp list` 确认 `node_repl` enabled。
10. 检查 `NODE_REPL_REQUEST_META` 是否包含 `x-codex-browser-use-disable-ambient-network=true`。
11. 用 `codex debug prompt-input '@chrome ping'` 确认新会话能看到 Chrome。
12. 用 `codex exec '@chrome ping'` 做真实握手验证。

## 8. 常见现象对应判断

### 8.1 当前 session 没有 `@chrome`

先看 `codex debug prompt-input '@chrome ping'`。

如果新 prompt 能看到 Chrome，但当前旧 thread 没有，通常是当前 thread 能力没有热加载。新建 thread 或重启 Codex。

### 8.2 `@chrome` 出现但报 `node_repl` 不可用

说明插件和 skill 已经加载，但缺少 `[mcp_servers.node_repl]` 配置。

补 `node_repl` MCP 后需要新建 session 或重启 Codex。

### 8.3 Chrome 扩展显示 `Disconnected`

优先看 native host manifest：

- manifest 是否存在。
- manifest path 是否指向当前可用 host binary。
- `allowed_origins` 是否包含当前扩展 ID。
- Chrome 是否重新打开过同一个 profile。

### 8.4 `setupAtlasRuntime()` 或 `@chrome ping` 超时

不要只盯着 native host。

如果最小 native pipe 握手正常，但 `setupAtlasRuntime()` 超时，优先检查：

```toml
NODE_REPL_REQUEST_META = "{\"x-codex-browser-use-available-backends\":[\"chrome\",\"iab\"],\"x-codex-browser-use-disable-ambient-network\":true}"
```

本次就是这个问题。

### 8.5 看到 `openai-bundled` 自动恢复但 Chrome 又没了

不要再把 Chrome 插件挂到 `openai-bundled` 上。

本次环境中 `openai-bundled` 会被 Codex Desktop 运行时 marketplace 覆盖，导致手动加入的 Chrome 插件被移除。

继续使用 `chrome-local`。

## 9. 本次最终状态

最终状态：

- `@chrome` 在新 session 中可见。
- `node_repl` MCP enabled。
- Chrome 扩展 installed/enabled。
- native host manifest correct。
- native host 进程来自 `chrome-local` cache。
- `@chrome ping` 成功。
- 成功检测到 8 个打开的 Chrome 标签页。

