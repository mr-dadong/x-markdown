# Markdown Editor

Markdown 编辑器，基于 Electron + Vue 3 + TipTap + TypeScript 构建。

## 功能特性

- ✅ 所见即所得的 Markdown 编辑体验
- ✅ 实时预览
- ✅ 支持标准 Markdown 语法
- ✅ 代码高亮
- ✅ 表格支持
- ✅ 图片插入
- ✅ 快捷键支持
- ✅ 文件操作（新建、打开、保存、另存为）
- ✅ 跨平台支持（Windows、macOS、Linux）

## 技术栈

- **桌面框架**：Electron
- **前端框架**：Vue 3 + Composition API + TypeScript
- **构建工具**：Vite + electron-vite
- **编辑器**：TipTap（基于 ProseMirror）
- **Markdown 解析**：markdown-it

## 快速开始

### 使用 Bun（推荐）

```bash
# 安装依赖
bun install

# 开发模式
bun run dev

# 构建生产版本
bun run build

# 预览生产版本
bun run preview
```

### 使用 npm

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

## 项目结构

```
markdown-editor/
├── electron/              # Electron 主进程
│   ├── main.ts            # 主进程入口
│   └── preload.ts         # 预加载脚本（contextBridge API）
├── src/                   # Vue 应用源码
│   ├── components/        # Vue 组件
│   │   └── MarkdownEditor.vue  # TipTap 编辑器组件
│   ├── utils/             # 工具函数
│   │   └── file.ts        # 文件操作工具
│   ├── App.vue            # 主应用组件
│   ├── main.ts            # Vue 入口
│   └── vite-env.d.ts      # TypeScript 类型声明
├── index.html             # HTML 入口
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript 根配置
├── tsconfig.node.json     # TypeScript Node 配置（主进程）
├── tsconfig.web.json      # TypeScript Web 配置（渲染进程）
├── electron.vite.config.ts # Vite 配置
├── bunfig.toml            # Bun 配置文件
├── BUN.md                 # Bun 使用指南
└── README.md              # 项目说明
```

## 使用说明

### 基本操作

1. **新建文件**：点击工具栏的 📄 按钮或使用 `Ctrl+N`
2. **打开文件**：点击工具栏的 📂 按钮或使用 `Ctrl+O`
3. **保存文件**：点击工具栏的 💾 按钮或使用 `Ctrl+S`
4. **另存为**：点击工具栏的 📝 按钮或使用 `Ctrl+Shift+S`

### Markdown 语法

支持标准 Markdown 语法，包括：

- **标题**：`# H1`、`## H2`、`### H3`
- **粗体**：`**粗体**`
- **斜体**：`*斜体*`
- **删除线**：`~~删除线~~`
- **代码**：`` `代码` ``
- **代码块**：``` ```代码块``` ```
- **链接**：`[链接](url)`
- **图片**：`![图片](url)`
- **列表**：`- 无序列表`、`1. 有序列表`
- **引用**：`> 引用`
- **表格**：使用 Markdown 表格语法
- **分割线**：`---`

### 快捷键

- `Ctrl+N`：新建文件
- `Ctrl+O`：打开文件
- `Ctrl+S`：保存文件
- `Ctrl+Shift+S`：另存为
- `Ctrl+Z`：撤销
- `Ctrl+Shift+Z`：重做
- `Ctrl+X`：剪切
- `Ctrl+C`：复制
- `Ctrl+V`：粘贴
- `Ctrl+A`：全选
- `F12`：开发者工具

## 自定义配置

### 修改编辑器配置

编辑 `src/components/MarkdownEditor.vue` 文件，可以：

- 添加或移除 TipTap 扩展
- 修改编辑器样式
- 配置 Markdown 解析选项

### 修改应用配置

编辑 `electron/main.ts` 文件，可以：

- 修改窗口大小和样式
- 自定义菜单
- 添加更多 IPC 通信

## 构建 Windows 安装包

Windows 安装包会注册传统资源管理器右键菜单，不需要 MSIX 或签名证书。在
Windows 11 中，该菜单显示在“显示更多选项”内：

```powershell
bun run dist:win
```

## 自动构建与发布

项目使用 GitHub Actions 自动构建 Windows、macOS 和 Linux 安装包。工作流配置位于
`.github/workflows/build.yml`。

### 构建产物

| 操作系统 | 架构 | 安装包 |
| --- | --- | --- |
| Windows | x64 | `.exe` |
| macOS | x64、arm64 | `.dmg` |
| Linux | x64、arm64 | `.AppImage` |

### 手动构建

打开 GitHub 仓库的 **Actions** 页面，选择“构建多平台安装包”，点击
**Run workflow**。手动构建完成后，可以在运行详情页面的 **Artifacts** 区域下载安装包，
但不会创建 GitHub Release。

### 发布新版本

发布前需要确保 `package.json` 中的 `version` 与 Git 标签版本一致。例如发布
`v1.0.3`：

```powershell
# 修改 package.json 中的 version 后提交并推送主分支
git add package.json
git commit -m "发布 1.0.3"
git push github main

# 创建并推送版本标签
git tag v1.0.3
git push github v1.0.3
```

标签推送后，GitHub Actions 会自动执行以下操作：

1. 并行构建 Windows、macOS 和 Linux 安装包。
2. 汇总所有平台的构建产物。
3. 创建名为 `XMD v1.0.3` 的 GitHub Release。
4. 根据提交记录自动生成发行说明。
5. 将 `.exe`、`.dmg` 和 `.AppImage` 安装包上传到 Release。

只有三个平台全部构建成功后才会创建 Release。当前安装包没有配置 Windows 和 macOS
代码签名，系统可能显示未知发布者或无法验证开发者的安全提示。

## 常见问题

### Q: 如何添加更多 TipTap 扩展？

A: 在 `src/components/MarkdownEditor.vue` 文件中：

1. 安装扩展包：`npm install @tiptap/extension-xxx`
2. 在 `extensions` 数组中添加扩展

### Q: 如何修改主题？

A: 编辑 `src/components/MarkdownEditor.vue` 文件中的 `<style>` 部分，修改 CSS 变量和样式。

### Q: 如何添加侧边栏文件树？

A: 需要：

1. 创建文件树组件
2. 使用 Electron 的 `dialog.showOpenDialog` 打开文件夹
3. 读取文件夹结构并显示

## 贡献指南

欢迎提交 Issue 和 Pull Request！

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE) 开源协议。
