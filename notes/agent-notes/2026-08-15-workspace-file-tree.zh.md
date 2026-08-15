# Agent Note：工作区文件树——侧边栏树（host.listFiles）+ 拖拽路径进输入栏

Status: implemented

[English](2026-08-15-workspace-file-tree.md) | 中文

## Problem

web GUI 展示工作区与会话，却不展示工作区的内容：操作者看不到会话将要处理的文件，把文件交给代理只能手打路径。[目录选择 seam](../architecture/2026-07-28-directory-picker-capability-seam.md) 只列目录（其契约是给选择器用的可进入行），查看者需要文件。

## Decision

侧边栏文件树基于新的宿主列举服务，树的每一行都是拖拽源：

- **宿主服务** —— [`dsh-host-file-tree`](../../../../packages/host/file-tree/README.md) 注册 `ctx.fileTree`（wire 行 `host.listFiles`）。每次调用返回一层文件与目录，按名称排序，以 `maxEntries`（默认 1000）为完整结果上限并报告 `truncated`，携带 hidden 标志（点前缀约定），符号链接的 kind 由 stat 探测决定，断链跳过，完全限定路径围栏，扫描随调用方 AbortSignal 中止。它复用 browse 后端的扫描引擎（`streamLevelWindow` 从 picker 的内联循环中抽出，两个消费方共用一份实现；`raceAbort`/`fullyQualified` 本已导出），但它是独立服务而非 picker 能力：picker 的仅目录契约服务着每一个选择型消费方，为查看者的需求扩宽它会重塑所有这些消费方。出现独立演进的第二个后端或消费方时，才是拆 seam 的时机。
- **Wire** —— `host.listFiles { path } → { path, entries: {name, path, kind, hidden}[], truncated }` 贯穿 apiproxy 链（类型、schema、rpc-map、fetch client/handler、api-proxy 实现经可选 `ctx.get('fileTree')`，服务未组合时报响亮的 `internal` 错误）。不进特权回环集：任何能启动会话的 `/api` 调用方本就能以本进程身份运行 `bash` 和 fs 工具，文件名列举不增加任何能力。
- **界面** —— [`dsh-client-ui-file-tree`](../../../../packages/client/ui-file-tree/README.md) 填进 ui-workspace 新声明的 `sidebar.workspaces.fileTree` 洞（`single`、root 作用域、owner `{ path }` = 当前 Session 的 Workspace 目录；洞未被占用时不渲染任何内容）。区块默认展开，挂载即加载根层，展开目录按需加载（响应到达前显示加载行），折叠保留缓存层，切换工作区重建树根（绝对路径没有可延续的状态），错误层带重试行与截断提示，隐藏行弱化显示而非过滤。
- **拖拽** —— 每一行都是 HTML5 拖拽源，其绝对路径同时写入 `text/plain` 与自定义风味 `application/x-dsh-workspace-path`。ui-conversation 的 document 级 drop 处理器（本就做图片接收）现在采纳该风味：树行拖到页面任意位置都不走附件栏，而是把路径落进草稿（非空草稿换行追加；锁定态拒绝）。风味是两个包里重复的稳定字面量——自定义 MIME 值只在一个文档的拖拽内存活，因此不存在共享导出。

## Consequences

操作者能看到工作区结构，一次拖拽把文件交给代理；代理用现有 Read 工具读取该路径。树只是查看器镀层——无模型可见输入、无会话事件、无协议版本提升（客户端与宿主同版发布）。行只携带名称与 kind；读取内容仍在会话内。

## Alternatives considered

- **给 browse 能力加文件。** 为查看者的需求重塑每个选择型消费方；picker 的仅目录契约是承重的（浏览器"可进入行"语义）。Rejected。
- **客户端经 picker seam 遍历。** 每层都要翻倍的仅目录列举加第二个原语，且把树耦合到 picker 的组合（`native` picker 组合下缺失）。Rejected。
- **拖拽成附件。** 附件 seam 只收图片（`imageLimits`、base64 接收）；路径引用无需内容传输且任何模型都可读。v1 Rejected，记入 Known Limitations。

## Verification

宿主服务在真实临时目录树上的 spec（kind、hidden、符号链接、断链、驱逐与窗口内截断、围栏、中止；符号链接→文件臂由 POSIX 通道执行，Windows 拒绝无特权文件符号链接故按行 ignore）；组件 spec 驱动树（懒加载、缓存、错误/重试、重建根、卸载后结算丢弃、拖拽风味）；client-flow spec 经 slot 注册表启动注册（声明前后、销毁、注入面）；input-bar spec 覆盖树拖放（落草稿、追加、锁定拒绝、无 overlay）。扫描引擎抽取保持 picker-browse 套件全绿。
