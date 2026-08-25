# XMD AI 模块实施计划

- 状态：草案
- 目标版本：待排期
- 依赖：需要引入 Mastra 运行时和相关模型 SDK
- 适用范围：XMD 桌面端 Electron 主进程 + Vue 3 渲染层

## 1. 背景和目标

XMD 是一款本地优先的 Markdown 编辑器。当前已经具备多标签编辑、工作区、导出、附件、主题、自动更新等能力。AI 模块的目标是围绕 Markdown 写作场景提供可选的 AI 能力，而不是把编辑器改造成一个通用聊天工具。

建议把 AI 模块设计成以下形态：

- 第一优先级是“选中文段即用”：润色、续写、总结、翻译、解释代码、修复代码。
- 第二优先级是“当前文档上下文”：对话侧栏、结构化生成、代码块助手。
- 第三优先级是“工作区级知识”：跨文档 RAG、文档审校、发布稿生成。

## 2. 参考产品对比

| 产品/模式        | 做得好的点                                       | XMD 借鉴                                               |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Notion AI        | 选中文本后直接触发润色、总结、翻译，结果就近处理 | 优先做选区 AI 动作条                                   |
| Obsidian Copilot | Chat 侧栏、自定义提示词、本地/云模型、库级问答   | 后续做文档/工作区问答                                  |
| Craft/Coda       | 生成标题、大纲、表格、模板等结构化内容           | 针对 Markdown 语法生成表格、TOC、Callout、Mermaid 初稿 |
| Typora 类插件    | 保持原生 Markdown 编辑体验，不破坏正文           | AI 结果先预览，用户确认后再插入                        |
| Cursor 类编辑器  | 基于上下文、@文件引用、流式输出                  | 后续支持 @当前文档、@其他 md 文件                      |

结论：XMD 的 AI 应优先贴近“写作和文档操作”，不是先做通用聊天框。

## 3. 功能分层

### 3.1 P0：选段 AI 能力

这是首版必须完成的最小闭环。

- AI 设置
  - Provider、Model、API Key/Endpoint。
  - 首批支持 OpenAI、Anthropic、Ollama 等可扩展配置。
  - API Key 不写入 localStorage，由主进程通过 Electron safeStorage 或环境配置管理。
- 选区动作
  - 润色
  - 续写
  - 总结
  - 翻译
  - 扩写/压缩
  - 解释代码
  - 修复代码
- 结果工作流
  - 流式输出。
  - 支持取消。
  - 支持插入到光标、替换选区、复制、重试。
  - 网络失败、缺少配置、超时、限流时给出明确提示。
- UI 入口
  - 选中文本后出现 AI 动作条。
  - 不破坏现有右键菜单和快捷键体系。

### 3.2 P1：文档级 AI

- 当前文档 Chat 侧栏
  - 多轮对话。
  - 可插入到光标。
  - 可替换选中文本。
- 自定义提示词库
  - 内置常用模板：总结、润色、续写、生成大纲、生成 TOC。
  - 允许用户保存自定义提示词。
- Markdown 结构化生成
  - 标题大纲。
  - TOC。
  - Markdown 表格。
  - Callout。
  - Mermaid 初始结构。
  - frontmatter。
- 代码块助手
  - 解释代码。
  - 添加注释。
  - 生成测试。
  - 给出重构建议。

### 3.3 P2：工作区级 AI

- 工作区 RAG
  - 用 Mastra RAG / vector store 索引工作区内 `.md` 文件。
  - 按标题切块。
  - 支持基于嵌入向量的文件搜索和问答。
- 文档工作流 Agent
  - 自动整理长文档。
  - 按项目风格重写。
  - 生成自媒体投稿、发布稿。
  - 自动补 frontmatter、标签、摘要。
- 本地模型支持
  - Ollama。
  - LM Studio。
  - 面向隐私敏感场景。
- Prompt 评估
  - 用 Mastra evals 对常用 AI 动作做回归测试。

## 4. 目标架构

### 4.1 架构原则

- Electron 主进程持有 AI 运行时，渲染层只做交互。
- 渲染层不直接调用模型 SDK，也不持有 API Key。
- 文件读取、安全存储、网络请求、取消逻辑都放在主进程。
- IPC 通道保持小粒度和可测试性。
- AI 请求上下文默认只包含用户主动触发的选区和当前文档上下文，不做隐式全量上传。

### 4.2 建议目录

```text
src/types/ai.ts                       # AI 请求、流式响应、设置类型
src/services/aiService.ts             # 渲染层 IPC 封装
src/composables/useAiAssistant.ts     # AI 状态机、取消、插入/替换
src/components/ai/AiInlineAction.vue  # 选中文本后的 AI 动作条
src/components/ai/AiChat.vue          # Chat 侧栏，后续迭代
electron/ai/mastra.ts                 # Agent/Workflow 初始化
electron/ai/agents/writer.ts          # 写作/编辑类 Agent
electron/ai/prompts.ts                # Prompt 模板
electron/ai/ipc/aiIpc.ts              # ai:* IPC handlers
```

### 4.3 与现有代码的接入点

- electron/main.ts
  - 在应用启动阶段初始化 AI 服务。
  - 注册 AI IPC handlers。
- electron/preload.ts
  - 暴露 `aiService` 相关方法。
- src/constants/ipcChannels.ts
  - 新增 AI 相关 channel。
- src/types/electron.ts
  - 补充 preload API 类型。
- src/views/EditorView.vue
  - 挂载 AI 动作入口和结果预览。
- src/composables/useSettings.ts
  - 增加 AI 配置区。

### 4.4 IPC 设计

```text
renderer -> main: { requestId, action, selection, documentContext, options }
main    -> renderer: { requestId, delta }
main    -> renderer: { requestId, done }
main    -> renderer: { requestId, error }
renderer -> main: { requestId }   // cancel
```

建议在 preload 中统一抽象成：

```ts
aiService.invoke(request): Promise<void>
aiService.cancel(requestId): void
aiService.onDelta(callback): unsubscribe
aiService.onDone(callback): unsubscribe
aiService.onError(callback): unsubscribe
aiService.getSettings(): Promise<AiSettings>
aiService.saveSettings(settings): Promise<void>
```

### 4.5 Mastra 使用建议

简单单轮动作使用 Agent：

```ts
const writerAgent = new Agent({
  name: "xmd-writer",
  instructions: `
你是 XMD 的 Markdown 写作助手。
根据用户动作处理选区，返回 Markdown，不要过度解释。
`,
  model: resolveModelFromSettings(aiSettings),
  tools: {
    getSelection,
    getDocumentContext,
  },
});
```

复杂多步任务使用 Workflow，例如：

- 先读取文档结构。
- 再根据目标生成新版本。
- 最后输出 Markdown 补丁。

后续做 RAG 时，建议用 Mastra vector store 建立工作区索引：

```text
工作区 .md 文件
  -> 按标题/段落切块
  -> embeddings
  -> 存入 Mastra vector store
  -> Chat / 搜索时召回相关片段
```

索引文件放在 `app.getPath("userData")` 下，避免污染用户工作区。

## 5. 实施步骤

### 阶段 A：基础设施

- [x] 安装 `@mastra/core`、模型 SDK、`@mastra/rag`（后续）。
  - 已安装 `@mastra/core`、`@mastra/rag`、`openai`。
- [x] 新增 `electron/ai/**` 目录。
- [x] 新增 `src/types/ai.ts`。
- [x] 新增 IPC channels 和 preload API。
- [x] 实现 AI 设置存储。

产出：可以保存 AI 配置，并能在主进程初始化 Agent。

### 阶段 B：P0 选区动作

- [x] 在 MarkdownEditor 中暴露当前选区文本。
- [x] 新增选中文本后的 AI 动作条。
- [x] 实现流式返回和取消。
- [x] 实现插入/替换/复制/重试。
- [x] 补充错误提示和加载态。

产出：用户能选中一段文本，触发润色、总结、翻译等动作。

### 阶段 C：P1 文档级能力

- [ ] 新增当前文档 Chat 侧栏。

- [ ] 新增自定义提示词库。

- [ ] 新增结构化 Markdown 生成。

- [ ] 新增代码块助手入口。

产出：用户可以在文档上下文中进行多轮对话和生成。

### 阶段 D：P2 工作区级能力

- [ ] 建立工作区 Markdown 索引。

- [ ] 实现跨文档问答和搜索。

- [ ] 实现文档工作流 Agent。

- [ ] 接入本地模型。

- [ ] 增加 Prompt 评估。

产出：AI 成为可感知工作区上下文的编辑助手。

## 6. 安全与隐私

- API Key 只保存在主进程可访问的安全位置，不在渲染层持久化。
- 用户主动触发 AI 动作时才发送内容。
- 默认不自动上传整个工作区。
- RAG 索引默认只保存在本机。
- 外部模型的请求 URL 由配置控制，默认只允许 HTTPS。
- 渲染层收到模型错误时只透出安全可读信息。

## 7. 验收标准

P0 验收：

- 用户可以在设置页配置 Provider/Model/API Key。
- 选中文本后可以触发至少一种 AI 动作。
- AI 结果流式显示，可取消。
- 用户可以选择插入、替换、复制或重试。
- 缺少配置或请求失败时 UI 有明确反馈。
- 现有编辑、保存、导出、侧栏功能不被破坏。

P1/P2 验收将根据具体迭代计划单独补充。

## 8. 待确认事项

- 首批模型重点是云 API 还是本地模型。
- 是否接受把当前文档全文作为默认上下文。
- 是否要做多语言 Prompt 模板。
- 是否要支持用户自定义系统 Prompt。
- 后续是否规划云端同步或服务端 Agent。

## 9. 下一步建议

先实现 P0 骨架，而不是直接铺开 Chat 和 RAG：

1. 添加 Mastra 主进程运行时。
2. 补 AI 设置和 IPC 通道。
3. 实现选中文本动作条和流式插入/替换。
4. 再在 P1 中扩展文档级 Chat 和结构化生成。

这个顺序可以让 AI 模块先以低风险、高使用频率的功能进入产品，同时为后续 RAG 和 Workflow 留出清晰边界。