# dsh-desktop

**DeepSeek Harness 桌面客户端** — 把 dsh agent 工作台装进一个原生窗口。

![Release](https://img.shields.io/github/v/release/hjjtt/dsh-desktop?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

## ✨ 功能特性

- 🖥 **原生桌面窗口** — Electron 窗口与后台 `dsh web` 宿主同生命周期：宿主崩溃自动重启、界面自动恢复；窗口位置与尺寸自动记忆；外链交给系统浏览器打开
- 📁 **工作区文件树** — 侧栏「会话 / 文件」双视图一键切换；文件树整栏显示当前工作区目录，逐级懒加载，支持错误重试与超长列表截断提示，隐藏文件淡化显示
- 🖱 **拖拽即引用** — 把任意文件或目录从文件树拖进对话输入框，自动生成绝对路径引用，agent 直接可读
- 📦 **开箱即用** — 安装包内置完整运行时（含 dsh 闭包），**无需安装 Node.js**，下载即用

## 📥 下载安装

前往 [Releases](https://github.com/hjjtt/dsh-desktop/releases) 下载：

| 文件 | 说明 |
|---|---|
| `DeepSeek Harness Setup 0.2.0.exe` | Windows 安装包（123 MB，NSIS） |
| `DeepSeek Harness-0.2.0-win.zip` | 免安装版（168 MB，解压即用） |

安装后启动 `DeepSeek Harness.exe` 即可。

## 🖼 界面一览

- **左侧栏**
  - 顶部「新会话」入口与搜索
  - 「会话」视图：按工作区分组浏览会话，支持重命名、归档、拖拽排序
  - 「文件」视图：当前工作区目录树，点击展开子目录，行内显示加载/错误/空目录状态
- **主区域** — 对话与 agent 工作区

## 🛠 从源码构建

本项目在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) monorepo 体系内构建；`patches/apply-on-upstream.patch` 包含与 monorepo 的集成改动（界面标签页、wire 契约、目录选择器等）。

```sh
# 1. 准备 monorepo 并应用集成改动
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git apply /path/to/dsh-desktop/patches/apply-on-upstream.patch

# 2. 放入本项目组件
cp -r /path/to/dsh-desktop/apps/desktop               apps/
cp -r /path/to/dsh-desktop/packages/client/ui-file-tree packages/client/
cp -r /path/to/dsh-desktop/packages/host/file-tree      packages/host/

# 3. 安装、构建、打包
pnpm install
pnpm run build
cd apps/desktop && pnpm run dist   # 产物输出至 dist-exe/
```

## 📁 目录结构

```
apps/desktop/                 桌面壳：Electron 主进程、sidecar 监管、打包流水线
packages/client/ui-file-tree/ 文件树界面组件（懒加载、拖拽引用）
packages/host/file-tree/      宿主侧目录列举服务（listFiles）
patches/                      与 DeepSeek Harness monorepo 的集成改动
notes/                        特性实现笔记（设计决策与取舍）
```

## 📄 许可证

[MIT](LICENSE)

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）构建。
