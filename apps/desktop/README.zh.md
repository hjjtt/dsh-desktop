# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 桌面壳:一个 Electron 窗口,内载 sidecar 形态的 `dsh web` 宿主。主进程在操作系统随机分配的回环端口上拉起宿主,等待 `dsh web:` 就绪行,然后在该 origin 上加载窗口;浏览器客户端原样运行,包括其重连约定。设计记录见[桌面壳 Agent Note](../../.agents/notes/implemented/feature/2026-08-14-desktop-electron-sidecar-shell.md)。

## 从源码检出运行

```sh
pnpm run build                                    # host lib, tsdown bundle, frontend dist
pnpm --filter @deepseek-ai/dsh-desktop start      # opens the window
```

`DSH_DESKTOP_DSH_BIN=<entry>` 覆盖 dsh 入口文件:`.ts` 走系统 Node 加 tsx,其余以纯 Node 方式跑在 Electron 二进制下。`DSH_DESKTOP_SMOKE=1` 把可见窗口替换为无头验收流程,页面加载完成后以 0 退出。

## 构建应用程序

```sh
pnpm run build                                            # required artifacts for staging
pnpm --filter @deepseek-ai/dsh-desktop run stage          # pnpm deploy closure + completion
pnpm --filter @deepseek-ai/dsh-desktop exec electron-builder --win
```

`stage` 按仓库的 `pnpm deploy` 配方暂存到 `.stage/dsh`,把闭包补全到不动点(legacy deploy 会漏掉 peer 需要的工作区包与 override 链接的 vendored 包),消除全部链接,断言每个硬依赖都在暂存内闭环,并裁掉构建期重量 —— TypeScript 声明、source map 与各包文档约占闭包文件数一半,运行时从不读取,却是安装耗时的大头(实测 win-x64:37,485 → 17,253 个文件,静默安装 371 秒 → 200 秒)。electron-builder 随后产出 `dist-exe/win-unpacked/`(便携应用)、NSIS 安装器与便携 zip;闭包由 `afterPack` 钩子拷入,因为 `extraResources` 会按本应用自身的依赖图剪掉它携带的任何 `node_modules`。macOS 目标需在 macOS 上暂存闭包以获得该平台原生 addon;安装器图标与代码签名尚未配置。

安装耗时主要由载荷文件数与杀毒软件实时扫描的相互作用决定,NSIS 进度条在大压缩块解压期间停在一点是正常现象,不是卡死。把安装目录加入实时扫描排除,是用户侧仅存的有效手段。

## 代码签名与免费分发路线

签名完全由环境变量激活 —— 证书到位时无需改任何配置:

| 路径 | 成本 | 激活方式 | 效果 |
|---|---|---|---|
| 不签名(免费) | — | 直接构建 | Windows 显示"未知发布者";用户点*更多信息 → 仍要运行*;SmartScreen 信誉随下载量缓慢积累 |
| [Certum Open Source](https://certum.eu) 证书 | 约 €25/年 —— 最便宜的真证书,本 MIT 项目符合资格 | `CSC_LINK=<base64 pfx>` + `CSC_KEY_PASSWORD` | 消除"未知发布者";OV 级 SmartScreen 信誉 |
| 任意 CA 的 PFX OV/EV | OV 约 $100–400/年;EV 约 $300–700/年 | 同上环境变量 | EV 立即获得 SmartScreen 信誉 |
| Azure Trusted Signing | 约 $10/月,无需令牌 | `electron-builder.yml` 中的 `win.azureSignOptions` + Entra ID 凭据环境变量;与 `signtoolOptions` 互斥 | 与 OV 相同的 SmartScreen 效果 |

`signtoolOptions.rfc3161TimeStampServer` 已配置:签名带 RFC3161 时间戳,证书过期后签名仍然有效。签名管线已用自签名 `CodeSigningCert` 端到端验证(应用 exe 与 NSIS 安装器上都观察到签名者主题与时间戳;状态显示 `UnknownError` 仅因自签名链不受信)。真证书改变的只是信任链,不是接线。

### 免费档做满

没有证书时,主推**便携 zip** 分发,安装器作为可选:zip 用 Windows 自带 `tar -xf`(或任意解压工具)约 17 秒部署,而 NSIS 安装器约 200 秒;zip 完全跳过安装器 UI 与注册表,删除文件夹即卸载。语言包已裁剪为 `zh-CN` + `en-US`(省 53 个文件、约 40 MB)。剩余安装耗时来自杀毒实时扫描对文件数的放大 —— 目标目录加入扫描排除是用户侧手段,签名是发布侧手段。

## 行为

| 关注点 | 约定 |
|---|---|
| 宿主生命周期 | 每个壳一个 sidecar;崩溃即重启(120 秒内至多 3 次)并重载窗口,超限则报告并退出。 |
| 窗口 | 单窗口;几何信息持久化在 Electron userData 下并钳制到可见显示器;外部导航交给系统浏览器。 |
| 安全 | 窗口绝不离开回环 origin;操作系统随机端口避免可猜测端口。宿主本身无鉴权([webserver 约定](../../packages/host/webserver/README.md))。 |
| 关停 | 退出时停止宿主:POSIX 走 SIGTERM,Windows 走强制杀树(子进程信号在该平台无法优雅送达)。 |

## 已知限制与未竟工作

- **安装包打包还很简单**:单一 Electron 默认图标、无代码签名、仅 Windows NSIS;macOS 与 Linux 目标及其原生 addon 暂存未验证。
- **Windows 停止路径是硬杀**:Windows 上的 `ChildProcess.kill()` 无法执行宿主的 SIGTERM 监听器;追加即持久的会话日志把损失限制在写入中的尾部。
