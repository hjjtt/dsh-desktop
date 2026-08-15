# Agent Note: 桌面壳 —— 内载 sidecar dsh web 宿主的 Electron 窗口

Status: implemented

[English](2026-08-14-desktop-electron-sidecar-shell.md) | 中文

## Problem

DeepSeek Harness 交付的是浏览器 GUI:`dsh web` 在回环 HTTP 服务器上分发已构建的前端。桌面交付需要一个原生窗口,同时不改客户端栈、不动线协议。[GUI 分层笔记](../architecture/2026-07-19-gui-layering-and-rpc-protocol.md)为 Electron 预留了座位,但把范围限定在 IPC fetch 载体 —— 以 `file://` 加载 dist、fetch 走 IPC 桥 —— 这需要先完成 bundle 载体与下行链路改造才能有第一个窗口。缺口在于:复用整套 Web 表层的第一个可交付桌面步骤。

## Decision

`apps/desktop`(`@deepseek-ai/dsh-desktop`)是一个 Electron 主进程:把现有 Web 宿主作为子进程运行并加载其 URL —— 协议、bundle、客户端零改动:

- **Sidecar,而非进程内宿主。** 主进程以 `web --host 127.0.0.1 --port 0` 拉起 dsh CLI,端口由操作系统分配。就绪信号是 stdout 行 `dsh web: http://127.0.0.1:<port>`(由 `dsh-web-app` 在其 Loader 树结算后打印);[`src/urls.ts`](../../../../apps/desktop/src/urls.ts) 只接受回环 origin。宿主崩溃时重启 sidecar(120 秒内至多 3 次)并重载窗口 —— Web 客户端"重连即重建"的约定吸收这次中断。
- **启动形态。** 打包形态:`<resources>/dsh/lib/bin.js` 以纯 Node 方式跑在本应用自带的 Electron 二进制下(`ELECTRON_RUN_AS_NODE=1`),不依赖系统 Node。源码形态:`apps/cli/src/bin.ts` 走系统 Node 加 tsx 的 ESM 钩子,与 `pnpm dsh` 的源码启动一致。`DSH_DESKTOP_DSH_BIN` 可在两种形态下覆盖入口([`src/launch.ts`](../../../../apps/desktop/src/launch.ts))。
- **监管者职责。** [`src/sidecar.ts`](../../../../apps/desktop/src/sidecar.ts) 只拥有一个子进程:解析 URL 行的 `ready` promise、`exited` promise,以及从 SIGTERM 升级到强制杀树的幂等 `stop()`。重启策略在主进程,不在监管者。
- **窗口姿态。** 单个 `BrowserWindow`,`ready-to-show` 前隐藏,几何信息持久化在 Electron userData 下并钳制到可见显示器,开启 `contextIsolation` + `sandbox`,无 preload。导航被限制在宿主 origin 内;其余目标一律交给系统浏览器。
- **验收路径。** `DSH_DESKTOP_SMOKE=1` 以隐藏窗口引导真实 sidecar,`did-finish-load` 后以 0 退出,为整个壳提供无头端到端检查。

## Repository wiring

该包与同级的 apps 一样是发布成员:根 tsdown workspace 把 `lib/types/main.js` 打成 `lib/main.js`(Electron 保持 external —— 它是开发期运行时,npm 载荷只携带主 bundle,见 `appPackageFiles`)。Host 聚合引用该工程;`pnpm-workspace.yaml` 放行 Electron 的安装脚本(下载平台二进制),拒绝 `electron-winstaller` 的(未使用的 Squirrel 传递依赖);knip 把 `.mjs` 测试夹具与暂存脚本视为被 spawn 的入口。

## 应用打包

可安装应用从同一 sidecar 设计产出,协议零改动:

- **暂存**([`scripts/stage-dsh.mjs`](../../../../apps/desktop/scripts/stage-dsh.mjs)):按仓库的 `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod` 配方(四个 flag 归[单文件可执行笔记](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md)所有)写入 `apps/desktop/.stage/dsh`。因为关闭了 auto-install-peers,deploy 会漏掉 peer 需要的工作区包(exe manifest 手工补齐的同类缺口),pnpm override 又让 vendored 包(`@deepseek-ai/cosmokit`、`schemastery`)保持未链接;脚本因此把闭包补全到不动点 —— 暂存内任一 manifest 声明而暂存缺少的依赖或 peer,都从仓库安装中拷入(提升根、`vendor/` 源、再到 `.pnpm` store 条目)—— 随后把全部链接物化为字节,并断言每个非 optional 需求都在暂存内闭环。`apps/cli` 的 dependencies 显式列出被漏掉的运行时 peer,同样闭合了裸 `npm i -g @deepseek-ai/dsh` 安装的缺口。最后裁掉构建期重量:TypeScript 声明、source map 与各包文档运行时从不读取(Loader 只 import `package.json` + `lib/*.js`;`lib/types` 下的运行时 JS 树保留,部分包在该处提供浏览器安全通道),实测约占闭包文件数一半 —— 移除 20,234 个文件 / 73.7 MB,静默安装 371 秒 → 200 秒。安装耗时本质上是文件数经 NSIS 逐文件开销与杀毒实时扫描的放大;大压缩块解压期间进度条停在一点属正常现象。
- **electron-builder**([`electron-builder.yml`](../../../../apps/desktop/electron-builder.yml) + `scripts/after-pack.cjs`):主 bundle 走 asar;暂存闭包由 `afterPack` 钩子拷入,因为 `extraResources` 会按本应用自身的依赖图剪掉它携带的任何 `node_modules`("no node modules returned" —— 本应用只有 dev 依赖)。Windows 交付便携 `win-unpacked/`、NSIS 安装器与便携 zip;Electron 语言包裁剪为 `zh-CN` + `en-US`(53 个文件、约 40 MB)。无证书时 zip 是分发路径:`tar -xf` 约 17 秒部署,而安装器约 200 秒,且无安装器 UI 与注册表。代码签名仅凭环境变量激活 —— PFX 证书用 `CSC_LINK`/`CSC_KEY_PASSWORD`(最便宜的真证书:Certum Open Source,约 €25/年,开源项目资格),Azure Trusted Signing 用 `win.azureSignOptions`(二者互斥);`signtoolOptions.rfc3161TimeStampServer` 已固定,签名寿命超出证书有效期。签名管线已用自签名 `CodeSigningCert` 端到端验证:应用 exe 与安装器上都落了签名者主题与 RFC3161 时间戳(`UnknownError` 只是自签名链不受信)。闭包内的 `.node` addon 保持未签名 —— Windows 既不要求签名、也不把 SmartScreen 信誉挂在它们身上;macOS 公证目标将必须签名 `resources/dsh` 内所有嵌套二进制。
- **打包验收**:对打包后的 `DeepSeek Harness.exe` 跑 `DSH_DESKTOP_SMOKE=1`,经 Electron 二进制(`ELECTRON_RUN_AS_NODE`)引导内置闭包,页面加载后以 0 退出;已在 win-x64 上以 146 MB NSIS 安装器验证。

## Alternatives considered

- **宿主进程内嵌 Electron 主进程。** 省一个进程,但宿主崩溃连带 GUI,原生模块(node-pty、koffi)被迫针对 Electron ABI 重编,且违背产品"一进程一表层"的启动方式。放弃。
- **现在就实现 IPC fetch 载体。** 分层笔记的终态(`file://` dist、`doFetch` 走 IPC)彻底去掉回环端口,但需要为 `__DSH_BOOT__` 与插件 bundle 端点定制 bundle 载体,并覆写下行虚方法。推迟到 sidecar 壳站稳;本笔记不取代该设计。
- **Tauri。** Rust 壳仍需为 harness 运行时保留 Node sidecar,给产品引入第三门语言,且仓库没有为它预留座位。放弃。
- **用 extraResources 装闭包。** electron-builder 会按应用依赖图剪掉它拷贝的 `node_modules`;只有 dev 依赖时闭包到场即空。afterPack 钩子改为原样拷贝。经测量后放弃(`filter: ['**/*']` 不能绕过剪枝器)。
- **把宿主打进 asar。** 闭包含原生 addon(node-pty、koffi)、`.node` 二进制和 Loader 要写入的 profile 树;`resources/` 下的普通文件保持它们可执行、可写。放弃。

## Consequences

桌面表层免费搭乘每一次 Web 改动,自身不新增任何线协议面。接受的代价:多一个进程及其启动延迟;随机端口上无鉴权的回环服务器(与 `dsh web` 同姿态,见 [webserver 约定](../../../../packages/host/webserver/README.md));Windows 上的停止路径是硬杀 —— 该平台无法向子进程优雅送达信号 —— 追加即持久的会话日志把损失限制在写入中的尾部;以及每次 workspace 安装都要下载 Electron 二进制。

## Testing

纯逻辑部分无需显示器即可覆盖:`urls.spec.ts`(就绪行解析、仅回环接受)、`launch.spec.ts`(三种启动形态与失败路径)、`sidecar.spec.ts`(ready 解析、早退拒绝带输出尾部、就绪超时杀进程、幂等 stop;优雅 SIGTERM 退出码仅在 POSIX 断言)。冒烟路径覆盖组装后的壳:真实 Electron 主进程、真实 sidecar 引导、页面加载。

## Deferred

- macOS 与 Linux 打包目标(各平台原生 addon 暂存)、应用图标、代码签名与自动更新接线。
- 目录选择器 `native` 交互的 Electron 提供方([能力 seam](../architecture/2026-07-28-directory-picker-capability-seam.md))。
- 作为无端口终态的 IPC fetch 载体。
