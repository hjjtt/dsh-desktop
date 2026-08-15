# @deepseek-ai/dsh-host-file-tree

[English](README.md) | 中文

web GUI 宿主的**文件树服务**：`FileTree` 以 `ctx.fileTree` 注册服务，基于 Node 标准库提供**文件与目录**的单层列举，供 API 网关的 `host.listFiles` 服务侧边栏工作区树。它与 [目录选择器 browse 后端](../directory-picker-browse/README.md) 共用扫描引擎（`streamLevelWindow`、`raceAbort`、`fullyQualified`），但回答的是另一个问题——这个目录里有什么（含文件）——服务于另一个消费方，因此它是独立服务而非 picker 能力：picker 的契约只返回可进入的目录，扩宽它会为查看者的需求重塑每个选择型消费方。出现独立演进的第二个后端或消费方时，才是拆成能力 seam 的时机。

行为事实：一次 `list(path, signal)` 调用至多返回 `maxEntries` 行（配置项，默认 1000——GitHub 网页端对目录列举采用的同一上限），文件与目录统一按名称排序；每行携带绝对宿主路径（客户端从不自行拼接段）、`kind`（`file`/`directory`——符号链接的 kind 由目标的 stat 探测决定）和宿主判定的 `hidden` 标志（POSIX 点前缀约定）。层级以有界窗口流式扫描，无论目录有多少子项内存都保持 O(maxEntries)；被截断的层级保留按名排序的头部、隐藏行计入上限，并报告 `truncated: true`。断链或循环符号链接被静默跳过（树只展示名称背后真实存在的东西）。`path` 必须是完全限定路径——相对形式，以及 Windows 上 `isAbsolute` 会放行的无盘符有根形式（`\foo`、`/foo`）与不完整的 UNC 前缀（`\\`、`\\server`）——一律报 `directory-unreadable`，而不是让 `resolve` 把 wire 值重定位到宿主进程 cwd 或当前盘符之下；调用方的 `AbortSignal` 会停止扫描（网络盘卡住时不得拖住已离场的调用方）。失败抛出 picker seam 的类型化 `DirectoryPickerError`，网关将其 1:1 映射到 wire。

## Model Experience

无：该服务只喂给 GUI 宿主的工作区树，不接触任何模型请求。

#### KV Cache effect

无：本包既不组装也不发送任何 provider 请求。

## Known Limitations and Deferred Work

- **不读 Windows 隐藏属性** —— Node dirent 不暴露 `FILE_ATTRIBUTE_HIDDEN`，所以在引入原生探测前，`hidden` 在所有平台都只代表点前缀。
- **全文件系统范围** —— 没有按部署限定的列举根。`workspace.create` 接受任意路径，因此这里的根只是 UX 边界而非安全边界。
- **除名称外无内容或元数据** —— 行不带大小、修改时间或文件内容；树只展示结构，读取文件属于会话的 Read 工具——等路径进入提示词之后。
