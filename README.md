# DeepSeek Harness 桌面版

把 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的 Web 界面封装成 Windows 桌面程序（Electron 壳）。开箱即用：自带便携 Node 运行时，目标机器无需预装 Node；默认与官方命令行版共享同一份数据目录。

## 特性

- **开箱即用**：打包产物自带便携 Node 运行时，目标机器无需安装 Node.js。
- **与官方版共享数据**：默认读写 `~/.dsh`，配置、MCP、插件、会话、设置、凭据与官方 `dsh web` 完全一致。
- **原生桌面体验**：独立窗口、外链交给系统浏览器、关闭窗口即干净退出。
- **安全**：服务仅绑定 `127.0.0.1`，渲染进程开启沙箱与上下文隔离。

## 快速开始（使用者）

从仓库的 **Releases** 页面下载最新安装包：

- `DeepSeek Harness Setup <版本>.exe`：NSIS 安装程序，安装后双击启动。

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

只有在想使用独立数据目录时，才需要设置 `DSH_HOME` 指向其它位置。

> 提示：桌面程序与命令行 `dsh web` 是两个独立的服务进程，共享同一目录没有问题；建议同一时间只运行其中一个（同时运行可能偶发 SQLite 会话索引锁竞争，DSH 使用 WAL 通常能容忍）。

## 从源码运行（开发者）

```powershell
git clone <仓库地址>
cd dsh-desktop
npm install
npm start
```

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_HOME` | 指定 DSH 数据目录；不设置则默认 `~/.dsh`（与官方共享） |
| `DSH_NODE` | 显式指定运行 DSH 的 Node 可执行文件（最高优先级） |
| `DSH_BIN` | 显式指定 dsh `lib/bin.js` 的绝对路径（一般无需设置） |

### 冒烟测试（不启动 GUI）

```powershell
node scripts/smoke.js                                          # 使用 ~/.dsh
$env:DSH_HOME = "$env:TEMP\dsh-smoke"; node scripts/smoke.js   # 全新 DSH_HOME，验证首次自举
```

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `main.js` | Electron 主进程：启动服务、创建窗口、生命周期管理 |
| `lib/server.js` | DSH 启动器：解析 Node、spawn、解析 URL、就绪探测、停止 |
| `preload.js` | 最小化的沙箱安全桥（仅暴露平台/版本信息） |
| `scripts/smoke.js` | 无 GUI 的启动器冒烟测试 |
| `scripts/build-icon.cjs` | 由 DSH 前端 favicon 生成 `build/icon.png` / `build/icon.ico` |
| `vendor/node/node.exe` | 便携 Node 运行时，打包进 `resources/node`（已 gitignore） |

## 构建与打包

### 1. 准备便携 Node（一次性）

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

以下 `package.json` 中的配置是长期调试得到的结论，改动前请先理解原因：

- **自带 Node（目标机器无需 Node）**：启动器按优先级选择运行时 —— `DSH_NODE` → 打包内置的 `resources/node/node.exe`（开发时为 `vendor/node/node.exe`）→ 系统 `node` → Electron 自带 Node。内置 Node 与开发机同版本，因此 `node_modules` 里的原生模块（`sharp`、`node-pty`、`koffi` 等）按系统 Node ABI 编译即可，无需针对 Electron ABI 重编译。
- **`build.npmRebuild = false`**：跳过 electron-builder 默认的 Electron ABI 重编译（那一步还要求本机安装对应 Windows SDK）。
- **`build.asar = false`**：DSH 通过「目录 junction 软链接」把 `$DSH_HOME/profiles/node_modules` 指向安装包的 `node_modules`，而 junction 无法指向 ASAR 归档内部，因此关闭 asar。
- **显式声明 DSH 的 peerDependencies**：electron-builder 收集依赖时只沿 `dependencies` 遍历、会丢弃 `peerDependencies`，否则安装后启动会报 `Cannot find package '@deepseek-ai/cordis-plugin-group'`。因此 `package.json` 里除 `@deepseek-ai/dsh` 外，还显式列出了 19 个 `@deepseek-ai/*` peer 依赖。升级 DSH 后若官方新增了「仅以 peerDependency 出现」的运行时包，需同步补进 `dependencies`。

## 安全

- 服务仅绑定 `127.0.0.1`（DSH 自身也拒绝 `--host 0.0.0.0`）。
- 渲染进程开启 `contextIsolation` + `sandbox`，关闭 `nodeIntegration`。
- 窗口内指向外部的链接一律交给系统浏览器打开，不离开当前 DSH 源。

## 许可

[MIT](./LICENSE)
