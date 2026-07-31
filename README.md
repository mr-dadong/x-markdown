# XMD

XMD 是一款基于 Electron、Vue 3、TipTap 和 TypeScript 构建的本地 Markdown 编辑器，提供所见即所得与源码两种编辑方式。

官网：[https://www.x-markdown.com/](https://www.x-markdown.com/)

## 功能

- 所见即所得和 Markdown 源码模式，可保留每个标签页的编辑模式
- 多标签文档，新建、批量打开、保存、另存为和标签排序
- 表格、任务列表、代码高亮、链接、图片、视频与附件
- 独立文件夹工作区、按需展开目录和外部文件变化自动刷新
- 文档大纲、行数/词数/字符数统计、浅色与深色主题
- 磁盘修改冲突检测和原子写入，避免静默覆盖外部修改
- 退出时保存全部、放弃修改或取消退出
- 未保存草稿自动恢复；正常保存或明确放弃后自动清理
- Windows、macOS、Linux 安装包和应用内更新检查

## 开发

项目使用 Bun 1.3.14，版本与 CI 保持一致。

```powershell
bun install --frozen-lockfile
bun run dev
```

常用检查命令：

```powershell
# 渲染进程类型检查
bun run typecheck

# Electron 主进程和 preload 类型检查
bunx tsc --noEmit -p tsconfig.node.json

# 只检查，不修改文件
bun run lint

# 自动修复可修复的 lint 问题
bun run lint:fix

# 生产构建
bun run build
```

## 使用

- `Ctrl+N`：新建文档
- `Ctrl+O`：打开一个或多个文档
- `Ctrl+S`：保存
- `Ctrl+Shift+S`：另存为
- `Ctrl+B`：显示或隐藏侧栏
- `Ctrl+,`：打开设置

侧栏中的“打开文件夹”用于建立独立工作区。工作区路径会保存在 Electron 用户数据目录，下次启动时自动恢复；工作区内新增、删除或重命名文件后，文件树会自动刷新。

编辑中的未保存内容会写入 Electron 用户数据目录。应用异常退出后，下次启动会恢复这些标签页。正常保存、关闭并放弃或退出并放弃时，对应草稿会被清理。

## 构建安装包

```powershell
bun run dist:win
bun run dist:mac
bun run dist:linux
```

构建产物写入 `release/`。Windows 使用 NSIS，macOS 使用 DMG，Linux 使用 AppImage。当前安装包未配置代码签名，操作系统可能显示未知发布者提示。

## 自动发布

`.github/workflows/build.yml` 支持手动构建，也会在推送 `v*` 标签时构建三个平台并创建 GitHub Release。发布前需保证 `package.json` 中的版本与标签一致：

```powershell
git tag v1.0.3
git push github v1.0.3
```

## 目录

```text
electron/   Electron 主进程、preload、IPC 与路径权限
src/        Vue 界面、编辑器扩展、组合式状态和服务
functions/  Cloudflare Pages Functions
worker/     Cloudflare Worker
site/       项目发布站点
build/      安装包资源
changelogs/ 应用更新清单与版本说明
```

## 许可证

[GNU General Public License v3.0](LICENSE)
