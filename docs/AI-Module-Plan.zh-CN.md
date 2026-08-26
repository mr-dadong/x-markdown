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

#### C.1 Chat 侧栏（替代当前 AI 助手面板）

**现状分析**

当前右上角 AI 图标点击后打开 `AiAssistantPanel`，该面板是一个静态动作网格 + 结果预览的组合。存在以下问题：

- 动作网格与选区工具栏 (`AiSelectionBar`) 功能高度重叠，用户困惑。
- 缺乏对话上下文，每次动作都是独立的单轮请求。
- 面板位置浮动在右上角，遮挡编辑区域，且无法持久化状态。
- "额外要求"输入框体验粗糙，无法表达复杂意图。

**目标**

将右上角 AI 图标改为打开 Chat 侧栏，提供基于当前文档上下文的多轮对话能力。Chat 侧栏是 P1 阶段的核心交互形态，替代现有的 `AiAssistantPanel`。

**交互设计**

```
┌─────────────────────────────────────────────────────────┐
│  AppHeader                                              │
│  [文件] [导出] [编辑] [视图] [窗口]    [🌙] [💬] [⚙]  │
│                                              ↑          │
│                                         Chat 侧栏入口   │
├──────────┬──────────────────────────┬───────────────────┤
│          │                          │  Chat 侧栏        │
│  侧边栏  │      MarkdownEditor      │  ┌─────────────┐ │
│          │                          │  │ 💬 AI Chat   │ │
│          │                          │  ├─────────────┤ │
│          │                          │  │ 对话消息列表  │ │
│          │                          │  │             │ │
│          │                          │  │ [用户消息]   │ │
│          │                          │  │ [AI 回复]    │ │
│          │                          │  │             │ │
│          │                          │  ├─────────────┤ │
│          │                          │  │ [输入框]     │ │
│          │                          │  └─────────────┘ │
└──────────┴──────────────────────────┴───────────────────┘
```

**功能规格**

1. **侧栏布局**
   - 固定在编辑区右侧，宽度 400px，可拖拽调整（最小 320px，最大 560px）。
   - 与左侧文件侧栏对称，不遮挡编辑区主体。
   - 打开/关闭状态持久化到本地存储，下次启动自动恢复。
   - 快捷键：`Ctrl+Shift+A`（可自定义）。

2. **消息系统**
   - 多轮对话，保留完整上下文。
   - 消息类型：用户消息、AI 回复、系统提示（如"已插入到文档"）。
   - AI 回复支持 Markdown 渲染（代码高亮、表格、列表等）。
   - 流式输出，逐字显示，支持中途取消。
   - 消息操作：复制、重新生成、插入到光标、替换选区。

3. **文档上下文集成**
   - 自动注入当前文档内容作为系统上下文（可配置开关）。
   - 支持 `@当前文档` 显式引用，发送全文或选区。
   - 支持 `@选区` 引用当前选中文本。
   - 用户消息中可用 `` `代码块` `` 语法高亮代码片段。

4. **快捷动作**
   - 输入框上方提供常用动作快捷按钮：
     - 总结文档
     - 生成大纲
     - 翻译选区
     - 解释代码
   - 点击后自动填充对应 Prompt，用户可修改后发送。
   - 动作列表可配置（设置页 > AI > 快捷动作）。

5. **结果处理**
   - AI 回复中的代码块右上角显示"插入"按钮。
   - 整条回复底部显示"插入到光标"和"替换选区"按钮。
   - 插入前预览 diff，确认后写入编辑器。
   - 支持撤销（Ctrl+Z）回退插入操作。

**技术实现**

```
src/components/ai/
├── AiChatSidebar.vue          # Chat 侧栏主容器
├── AiChatMessage.vue          # 单条消息组件（用户/AI/系统）
├── AiChatInput.vue            # 输入框 + 快捷动作
├── AiChatMessageActions.vue   # 消息操作按钮（复制/插入/重试）
└── AiChatContextPicker.vue    # @引用选择器

src/composables/
├── useAiChat.ts               # Chat 状态管理（消息列表、发送、取消）
└── useAiChatContext.ts        # 文档上下文注入逻辑

src/types/ai.ts                # 扩展 Chat 相关类型
```

**IPC 扩展**

```ts
// 新增 Chat 专用 IPC
aiService.chatInvoke(request: AiChatRequest): Promise<{ requestId: string }>
aiService.chatCancel(requestId: string): void
aiService.onChatDelta(callback): unsubscribe
aiService.onChatDone(callback): unsubscribe
aiService.onChatError(callback): unsubscribe

// Chat 请求结构
interface AiChatRequest {
  requestId: string
  messages: AiChatMessage[]      // 完整对话历史
  documentContext?: string       // 当前文档内容
  selection?: string             // 当前选区
  options?: {
    temperature?: number
    maxTokens?: number
  }
}

interface AiChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}
```

**与现有代码的改动**

| 文件 | 改动 |
|------|------|
| `AppHeader.vue` | AI 图标改为 Chat 侧栏开关，tooltip 改为"AI Chat (Ctrl+Shift+A)" |
| `EditorView.vue` | 移除 `AiAssistantPanel`，引入 `AiChatSidebar`；管理侧栏显隐状态 |
| `AiAssistantPanel.vue` | **废弃**，功能合并到 Chat 侧栏的快捷动作 |
| `AiSelectionBar.vue` | 保留，选中文本后仍显示动作条；动作结果发送到 Chat 侧栏展示 |
| `useAiAssistant.ts` | 重构为 `useAiChat.ts`，支持多轮对话 |
| `ai.ts` (types) | 新增 `AiChatMessage`、`AiChatRequest` 等类型 |
| `aiIpc.ts` | 新增 Chat IPC handlers |
| `aiService.ts` | 新增 Chat 相关方法 |

**状态管理**

```ts
// useAiChat.ts 核心状态
const messages = ref<AiChatMessage[]>([])
const isStreaming = ref(false)
const streamingContent = ref('')
const activeRequestId = ref('')

// 持久化：对话历史保存到 localStorage
// key: `ai-chat-${filePath}` （按文档隔离）
// 保留最近 50 条消息，超出后截断早期对话
```

**验收标准**

- [ ] 右上角 AI 图标点击打开 Chat 侧栏（替代原 AiAssistantPanel）。
- [ ] Chat 侧栏支持多轮对话，保留上下文。
- [ ] AI 回复流式显示，支持取消。
- [ ] 支持 `@当前文档` 和 `@选区` 引用。
- [ ] 消息中的代码块可一键插入到文档。
- [ ] 整条回复可插入到光标或替换选区。
- [ ] 侧栏打开/关闭状态持久化。
- [ ] 快捷键 `Ctrl+Shift+A` 切换侧栏。
- [ ] 选中文本后的动作条仍正常工作，结果在 Chat 侧栏展示。
- [ ] 对话历史按文档隔离保存。

---

#### C.2 自定义提示词库

**目标**

允许用户创建和管理自定义 Prompt 模板，在 Chat 侧栏和选区动作中复用。

**功能规格**

1. **内置模板**
   - 总结：`请用 3-5 句话总结以下内容`
   - 润色：`请润色以下文本，保持原意但提升表达质量`
   - 续写：`请根据上下文继续写下去`
   - 大纲：`请根据以下内容生成 Markdown 大纲`
   - TOC：`请根据标题层级生成目录`
   - 翻译：`请将以下内容翻译为{target_language}`

2. **用户自定义**
   - 设置页 > AI > 提示词库。
   - 支持增删改查，拖拽排序。
   - 变量占位符：`{selection}`（选区）、`{document}`（文档）、`{language}`（目标语言）。
   - 导入/导出为 JSON 文件。

3. **集成点**
   - Chat 侧栏输入框 `/` 触发提示词选择器。
   - 选区动作条末尾"更多"按钮展开自定义提示词列表。
   - 快捷动作配置中可选择自定义提示词。

**数据结构**

```ts
interface AiPromptTemplate {
  id: string
  name: string
  description?: string
  prompt: string           // 支持 {selection} {document} {language} 占位符
  category: 'built-in' | 'custom'
  icon?: string
  sortOrder: number
}
```

**存储**

- 内置模板硬编码在 `electron/ai/prompts.ts`。
- 用户自定义模板保存在 `app.getPath('userData')/ai-prompts.json`。
- 通过 IPC 暴露 CRUD 接口。

**验收标准**

- [ ] 设置页可管理提示词库（增删改查、排序）。
- [ ] Chat 侧栏 `/` 触发提示词选择器。
- [ ] 选区动作条可展开自定义提示词。
- [ ] 变量占位符正确替换。
- [ ] 支持导入/导出。

---

#### C.3 结构化 Markdown 生成

**目标**

在 Chat 侧栏中提供结构化内容生成能力，针对 Markdown 语法优化。

**支持的结构类型**

| 类型 | 触发方式 | 输出 |
|------|----------|------|
| 标题大纲 | Chat: "生成大纲" / 快捷动作 | 多级标题结构 |
| TOC | Chat: "生成目录" / 快捷动作 | `[链接](#锚点)` 列表 |
| 表格 | Chat: "生成表格" / 选区动作 | Markdown 表格 |
| Callout | Chat: "生成提示块" / 选区动作 | `> [!note]` 语法 |
| Mermaid | Chat: "生成图表" / 选区动作 | Mermaid 代码块 |
| frontmatter | Chat: "生成元数据" / 快捷动作 | YAML frontmatter |

**实现方式**

- 复用现有 `AiEditAction` 类型中的 `outline`、`toc`、`table`、`callout`、`mermaid`、`frontmatter`。
- 在 Chat 侧栏中，这些动作作为快捷按钮展示。
- AI 回复中的结构化内容自动识别，提供"插入"按钮。
- Mermaid 代码块插入后自动触发预览渲染。

**验收标准**

- [ ] Chat 侧栏快捷动作包含结构化生成按钮。
- [ ] 生成的 Markdown 结构语法正确。
- [ ] 插入后在编辑器中正确渲染。
- [ ] Mermaid 插入后自动显示图表预览。

---

#### C.4 代码块助手

**目标**

针对文档中的代码块提供专项 AI 辅助。

**功能规格**

1. **触发方式**
   - 光标在代码块内时，侧边栏显示"代码助手"面板。
   - 选中代码块后，选区动作条显示代码相关动作。
   - Chat 侧栏中可直接询问代码问题。

2. **支持动作**
   - 解释代码：逐行注释说明。
   - 添加注释：生成 JSDoc/docstring 风格注释。
   - 生成测试：根据代码生成单元测试框架。
   - 重构建议：提供优化方案和重构后代码。
   - 语言转换：将代码转换为其他语言。

3. **上下文感知**
   - 自动识别代码语言（从 fenced code block 的语言标识）。
   - 注入相邻段落作为业务上下文。
   - 支持 `@其他文件` 引用相关代码（P2 阶段）。

**集成点**

- `MarkdownEditor` 中检测光标位置，若在代码块内则显示代码助手入口。
- Chat 侧栏输入框检测到代码相关问题时，自动注入代码块上下文。
- 选区动作条：选中代码时显示"解释"、"注释"、"测试"、"重构"按钮。

**验收标准**

- [ ] 光标在代码块内时显示代码助手入口。
- [ ] 选中代码后动作条显示代码相关动作。
- [ ] 代码语言自动识别。
- [ ] 生成的注释/测试语法正确。
- [ ] Chat 中询问代码问题时自动注入上下文。

---

**阶段 C 总体产出**

用户可以通过 Chat 侧栏进行基于文档上下文的多轮对话，使用自定义提示词，生成结构化 Markdown 内容，并获得代码块专项辅助。右上角 AI 图标从简单的动作面板升级为完整的对话式 AI 助手。

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