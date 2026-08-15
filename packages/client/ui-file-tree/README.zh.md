# @deepseek-ai/dsh-client-ui-file-tree

[English](README.md) | 中文

工作区**文件树界面**：侧边栏一个可折叠区块，经 `host.listFiles`（[`dsh-host-file-tree`](../../host/file-tree/README.md) 后端）列出当前 Workspace 的目录树，每个展开的目录按需加载一层。它填进 [ui-workspace](../../client/ui-workspace/README.md) 的 `sidebar.workspaces.fileTree` 洞；洞未被占用时不渲染任何内容，因此未组合本包的部署只是不显示树区块。

行为事实：区块默认展开，挂载即加载 Workspace 根层；展开目录会发起该层加载（响应到达前显示加载行），折叠保留已缓存层，切换 Workspace 会重建树根（丢弃缓存层与在途加载——路径是绝对的，没有可延续的状态）。行按宿主返回的名称排序渲染文件与目录，隐藏行（点前缀）以弱化样式显示而非过滤。失败层显示带重试按钮的错误行；宿主截断的层显示截断提示。**每一行都是 HTML5 拖拽源**，其绝对路径同时写入 `text/plain` 与 `application/x-dsh-workspace-path` 风味，对话输入栏将其采纳为草稿中的路径引用（ui-conversation 读取同一字面量；自定义 MIME 值只在一个文档的拖拽内存活，因此不设共享导出）。拖目录行引用的是目录本身。

## Model Experience

无：该界面只服务 GUI，不接触任何模型请求。

#### KV Cache effect

无：本包既不组装也不发送任何 provider 请求。

## Known Limitations and Deferred Work

- **无刷新与监听** —— 树只在展开时列举；外部文件变化要等重建树根（切换 Workspace）或刷新页面后才出现。
- **拖入的是路径而非内容** —— 输入栏收到的是供代理读取的路径引用；二进制/文件内容上传仍属于图片附件栏。
- **隐藏行照常显示** —— 点文件以弱化样式渲染，绝不在客户端过滤；完全隐藏它们是展示策略的后续事项。
