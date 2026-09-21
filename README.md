# DeepSeek Harness 桌面版（dsh-desktop）

把 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的 Web 界面封装成 Windows 桌面程序（Electron 壳）。

自带便携 Node 运行时，目标机器**无需预装 Node.js**；默认与官方命令行版**共享同一份数据目录**（配置、MCP、插件、会话、凭据）。

> ⚠️ 本项目是**社区非官方封装**，与 DeepSeek 官方无隶属关系。DSH 本体版权归官方所有，本项目仅做桌面壳与打包。

## 特性

- **开箱即用** —— 打包产物自带便携 Node 运行时，目标机器无需安装 Node.js。
- **与官方版共享数据** —— 默认读写 `~/.dsh`，配置、MCP、插件、会话、设置、凭据与官方 `dsh web` 完全一致。
- **稳定端口** —— 优先复用上次端口、其次官方默认 `3080`，避免端口漂移导致 DSH 提示词缓存失效；端口状态存放在应用 userData 目录，不污染 `~/.dsh`。
- **自动转发系统代理** —— DSH 只认代理环境变量、不读操作系统代理设置，桌面版会把 Windows 的系统代理（WinINET）自动转成环境变量传给 DSH，`web_fetch`、联网搜索、LLM、HTTP MCP 等出站请求因此能在需要代理的网络下正常工作。
- **原生桌面体验** —— 独立窗口、外链交给系统浏览器、关闭窗口即干净退出、启动时不会额外弹出系统浏览器。
- **安全** —— 服务仅绑定 `127.0.0.1`，渲染进程开启沙箱与上下文隔离，并兼容 DSH 自带的浏览器令牌认证。

## 快速开始（使用者）

从本仓库的 **Releases** 页面下载最新安装包：

- `DeepSeek Harness Setup <版本>.exe` —— NSIS 安装程序，安装后双击启动。

**环境要求**：Windows 10 / 11（x64）。

首次启动会在 `~/.dsh`（即 `C:\Users\<用户名>\.dsh`）下自动初始化；若你已用过官方 DSH，会直接看到已有的会话、配置与插件。

## 与官方版共享数据

桌面程序默认**不覆盖** `DSH_HOME`，而是让 DSH 自行解析其默认主目录 `~/.dsh`，与官方 `dsh web` 走完全相同的解析逻辑。因此以下内容全部共享：

| 数据 | 位置 |
| --- | --- |
| 配置 / 设置 | `settings.yaml`、`cordis.patch.yml`、`.credentials.yaml` |
| MCP | `profiles\web\cordis.patch.yml` |
| 插件 | `profiles\web\package.json` + `profiles\node_modules` |
| 对话 / 会话 | `sessions\` |
| 其他存储 | `storages\`、`.anonymous-user-id` |

只有想使用**独立数据目录**时，才需要设置 `DSH_HOME` 指向其它位置。

> 提示：桌面程序与命令行 `dsh web` 是两个独立的服务进程，共享同一目录没有问题；建议同一时间只运行其中一个（同时运行可能偶发 SQLite 会话索引锁竞争，DSH 使用 WAL 通常能容忍）。桌面版的端口策略会自动避让已被占用的 `3080`。

## 从源码运行（开发者）

```powershell
git clone https://github.com/KnCRJVirX/dsh-desktop.git
cd dsh-desktop
npm install
npm start
```

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_HOME` | 指定 DSH 数据目录；不设置则默认 `~/.dsh`（与官方共享） |
| `DSH_DESKTOP_NO_SYSTEM_PROXY` | 设为任意非空值即关闭「系统代理自动转发」，让 DSH 按自身环境变量直连 |
| `http_proxy` / `https_proxy` / `no_proxy` | 手动指定代理时会**优先于**系统代理设置被原样使用 |
| `DSH_NODE` | 显式指定运行 DSH 的 Node 可执行文件（最高优先级） |
| `DSH_BIN` | 显式指定 dsh `lib/bin.js` 的绝对路径（一般无需设置） |

### 冒烟测试（不启动 GUI）

```powershell
node scripts/smoke.js                                          # 使用 ~/.dsh
$env:DSH_HOME = "$env:TEMP\dsh-smoke"; node scripts/smoke.js   # 全新 DSH_HOME，验证首次自举
```

脚本会启动 DSH、完成浏览器令牌交换、确认 UI 返回 200 后退出。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `main.js` | Electron 主进程：启动服务、创建窗口、生命周期管理 |
| `lib/server.js` | DSH 启动器：解析 Node、spawn、解析 URL、就绪探测、停止 |
| `lib/port.js` | 稳定端口选择：复用上次端口 → 默认 `3080` → 系统随机 |
| `lib/proxy.js` | 系统代理桥接：读取 WinINET 设置并注入 DSH 需要的代理环境变量 |
| `preload.js` | 最小化的沙箱安全桥（仅暴露平台/版本信息） |
| `scripts/smoke.js` | 无 GUI 的启动器冒烟测试（含令牌交换） |
| `scripts/build-icon.cjs` | 由 DSH 前端 favicon 生成 `build/icon.png` / `build/icon.ico` |
| `vendor/node/node.exe` | 便携 Node 运行时，打包进 `resources/node`（已 gitignore） |

## 构建与打包

### 1. 准备便携 Node

`vendor/node/node.exe` 已加入 `.gitignore`，打包前需手动准备，版本应与开发机 `node --version` 一致：

```powershell
$v = "24.19.0"
$url = "https://nodejs.org/dist/v$v/node-v$v-win-x64.zip"
New-Item -ItemType Directory -Force -Path vendor\node | Out-Null
$zip = "$env:TEMP\node.zip"
Invoke-WebRequest $url -OutFile $zip
tar -xf $zip -C $env:TEMP
Copy-Item "$env:TEMP\node-v$v-win-x64\node.exe" vendor\node\node.exe -Force
```

### 2. 生成图标

```powershell
npm run icon   # 由 node_modules 里的 DSH 前端 favicon 生成 build/icon.{png,ico}
```

### 3. 打包

```powershell
npm run pack   # 生成免安装目录 dist\win-unpacked（便于快速验证）
npm run dist   # 生成 NSIS 安装包 dist\DeepSeek Harness Setup <版本>.exe
```

## 打包要点

以下 `package.json` 中的配置都是踩坑得到的结论，改动前请先理解原因：

- **自带 Node（目标机器无需 Node）**：启动器按优先级选择运行时 —— `DSH_NODE` → 打包内置的 `resources/node/node.exe`（开发时为 `vendor/node/node.exe`）→ 系统 `node` → Electron 自带 Node。内置 Node 与开发机同版本，因此 `node_modules` 里的原生模块（`sharp`、`node-pty`、`koffi` 等）按系统 Node ABI 编译即可，**无需**针对 Electron ABI 重编译。
- **`build.npmRebuild = false`**：跳过 electron-builder 默认的 Electron ABI 重编译（那一步还会要求本机安装对应 Windows SDK）。
- **`build.asar = false`**：DSH 通过「目录 junction 软链接」把 `$DSH_HOME/profiles/node_modules` 指向安装包的 `node_modules`，而 junction 无法指向 ASAR 归档内部，因此关闭 asar。
- **必须显式声明 DSH 的 peerDependencies**：electron-builder 收集产物依赖时只沿 `dependencies` 遍历、会丢弃 `peerDependencies`，否则安装后启动会报 `Cannot find package '@deepseek-ai/cordis-plugin-group'` 之类的错误。因此 `package.json` 里除 `@deepseek-ai/dsh` 外，还显式列出了依赖树中仅以 peer 形式出现的 `@deepseek-ai/*` 运行时包（完整清单见 `package.json`）。
  **升级 DSH 后必做**：对比「项目 `node_modules`」与「打包产物 `node_modules`」，若出现新的 `@deepseek-ai/*` 缺项，把它按同版本补进 `dependencies` 后重新打包，否则安装版会启动失败。
- **验证打包完整性时，必须在项目目录之外启动**：在 `dist\` 内直接跑打包产物，Node 会沿父目录向上回溯到项目自身的 `node_modules`，从而掩盖缺包问题（表现为「本地测试通过，装到别人机器就报缺模块」）。可靠做法是把项目 `node_modules` 临时改名后再启动打包产物。

## 实现原理

DSH 本身就是一个「本地 HTTP 服务 + 前端静态资源」的 Web 应用（`dsh web`）。桌面程序只做四件事：

1. 选择监听端口（复用上次端口 → 官方默认 `3080` → 系统随机），启动内置的 `@deepseek-ai/dsh` CLI（`web` profile），绑定 `127.0.0.1`；
2. 从子进程 stdout 解析出 `dsh web: http://127.0.0.1:<port>/?token=<...>`，轮询确认 UI 已就绪；
3. 用 `BrowserWindow.loadURL()` 把该地址装进窗口（Chromium 自动完成令牌换 Cookie 的跳转）；
4. 退出时杀掉 DSH 子进程。

启动参数带上 `--no-open`，避免 DSH 自 0.1.2-rc.1 起「自动打开系统默认浏览器」的行为在桌面版里多弹一个浏览器窗口。

启动 DSH 子进程前，桌面版会读取 Windows 的系统代理（`HKCU\...\Internet Settings` 的 `ProxyEnable`/`ProxyServer`/`ProxyOverride`），把它转成 `http_proxy`/`https_proxy`/`no_proxy` 注入子进程环境——因为 DSH 的代理支持**只读环境变量、不探测操作系统代理设置**（上游明确的设计边界）。若你已自行设置过代理环境变量，则以你的为准；`no_proxy` 会保留系统绕过列表（`<local>` 展开为 loopback，CIDR 条目因无法匹配而丢弃），DSH 本身也始终绕过 loopback。

## 常见问题

**Q：需要自己装 Node.js 吗？**
不需要，安装包内置便携 Node 运行时。

**Q：启动时会不会弹出系统浏览器？**
不会。桌面版给 `dsh web` 传了 `--no-open`（DSH 0.1.2-rc.1+ 默认会用系统浏览器打开 Web UI）。

**Q：端口每次都一样吗？**
尽量一样：优先复用上次成功使用的端口，其次官方默认 `3080`，都被占用才由系统随机分配。这样 DSH 写进提示词的 URL 保持稳定，避免提示词缓存失效。

**Q：`web_fetch` / 联网搜索不走我配置的代理？**
桌面版（0.1.7+）已自动把 Windows 系统代理转发给 DSH。若你用的是更早的版本，或在其它环境下遇到，可以在 `~/.dsh/.env` 里写：

```
HTTPS_PROXY=http://127.0.0.1:10808
HTTP_PROXY=http://127.0.0.1:10808
```

DSH 的代理取值顺序是「环境变量 → `$DSH_HOME/.env`」，两种方式对命令行版同样有效。注意：**项目目录里的 `.env` 不允许携带这些变量**（DSH 会拒绝启动，避免一个仓库决定流量去向）。想关掉桌面版的自动转发，设 `DSH_DESKTOP_NO_SYSTEM_PROXY=1`。

**Q：能和命令行 `dsh web` 同时运行吗？**
可以，两者共享 `~/.dsh`；但建议同一时间只开一个。桌面版会自动避让已被占用的 `3080`。

**Q：会改动我原有的 DSH 数据吗？**
它读写的就是同一份 `~/.dsh`（这正是「共享」的目的）。想完全隔离，设置 `DSH_HOME` 指向一个新目录即可。

**Q：安装包为什么有一百多 MB？**
包含 Electron 运行时、便携 Node 和 DSH 的完整依赖树。

**Q：如何升级到新版本？**
下载新的安装包覆盖安装即可，`~/.dsh` 里的数据不受影响；首次启动新版本时可能需要重新建立浏览器会话（令牌认证），但会话与配置都不丢。

## 安全

- 服务仅绑定 `127.0.0.1`（DSH 自身也拒绝 `--host 0.0.0.0`）。
- 渲染进程开启 `contextIsolation` + `sandbox`，关闭 `nodeIntegration`。
- 窗口内指向外部的链接一律交给系统浏览器打开，不离开当前 DSH 源。
- 兼容 DSH 0.1.2-rc.1+ 的浏览器令牌认证：根路径需用 `?token=` 换取签名 Cookie，无 Cookie 的请求返回 401。

## 许可

[MIT](./LICENSE)
