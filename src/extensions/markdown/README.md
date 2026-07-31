# Markdown 扩展模块

每个目录都是独立的 TipTap 扩展，负责三件事：

1. 在 `parse.setup` 中把标准 Markdown 扩展语法转换成临时 DOM。
2. 通过 `parseHTML` 和 Node View 提供所见即所得显示与编辑。
3. 在 `serialize` 中写回原始 Markdown 语法，不保存私有 HTML。

`shared/` 只放多个模块共同使用的解析与安全渲染工具。新增模块时，在本目录的 `index.ts` 导出，再到 `useEditor.ts` 注册即可。

解析规则必须使用各自唯一的 `xmd_` 前缀，并用 `WeakSet<MarkdownIt>` 防止同一个解析器重复注册。
