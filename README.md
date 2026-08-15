# dsh-desktop — DeepSeek Harness 桌面壳与工作区文件树（自研部分）

本仓库只包含我们在 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 之上**自研的全部新增代码**，不包含任何上游源码：

- `apps/desktop/` — **桌面应用壳**：Electron 窗口 + `dsh web` sidecar 宿主。Electron 主进程拉起打包好的 dsh host 子进程，host 崩溃自动重启并重载窗口；打包流程（electron-builder + 生产闭包 staging）一并在此。
- `packages/client/ui-file-tree/` — **客户端文件树插件**：侧栏"会话/文件"标签页下的全高目录树，逐级懒加载（`host.listFiles`），每行可拖拽为绝对路径引用到对话输入框。
- `packages/host/file-tree/` — **宿主侧文件树服务**：目录层级列举能力（listFiles），走 apiproxy wire 契约。
- `notes/agent-notes/` — 两篇特性实现笔记（桌面壳、工作区文件树），记录设计决策。
- `patches/apply-on-upstream.patch` — 对上游已有文件的**配套修改**（WorkspaceBrowser 标签页改造、apiproxy wire schema、Win32 目录选择器绑定、workspace 注册等，55 个文件）。上游文件本体不收入本仓库，修改以 patch 形式提供。

## 依赖与使用

这些组件依赖上游 monorepo 的包体系（`@deepseek-ai/dsh-*`），不能独立编译。使用方式：

```sh
# 1. 检出上游仓库并应用配套修改
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git apply /path/to/apply-on-upstream.patch

# 2. 把本仓库的三个目录放进上游 checkout 对应位置
cp -r /path/to/dsh-desktop/apps/desktop        apps/
cp -r /path/to/dsh-desktop/packages/client/ui-file-tree  packages/client/
cp -r /path/to/dsh-desktop/packages/host/file-tree       packages/host/

# 3. 安装、构建、打包桌面 exe
pnpm install
pnpm run build
cd apps/desktop && pnpm run dist   # 产物在 dist-exe/
```

## 界面效果

侧栏顶部为"会话 / 文件"标签页：会话视图保持原有工作区分组浏览；文件视图整栏显示当前工作区目录树（根 = 当前会话所属工作区），支持逐级展开、错误重试、截断提示、隐藏文件淡化显示、拖拽路径到输入框。

## 打包产物

`pnpm run dist` 产出 `dist-exe/win-unpacked/DeepSeek Harness.exe`（免安装目录版）、NSIS 安装包与 zip。dsh 生产闭包由 `scripts/stage-dsh.mjs` 完成封闭性校验后随包分发，无需系统 Node。
