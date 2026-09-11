import { createTool } from "@mastra/core/tools";
import type {
  DocumentAgentEvent,
  DocumentAgentOperation,
  DocumentAgentStage,
} from "../../src/types/documentAgent";
import { validateAgentDocument } from "../../src/utils/documentAgent";
import { normalizeAiMarkdown } from "../../src/utils/aiMarkdown";
import { createDocumentAgentDraft, type DraftEdit } from "./documentAgentDraft";
import { indexDocumentBlocks } from "../../src/utils/documentAgentBlocks";
import { normalizeLineEndings } from "./literalEdit";

/** 单文档内存工作区：模型始终读取、修改最新草稿，磁盘和编辑器由现有审阅流程负责。 */
export function createDocumentAgentTools(
  document: string,
  signal: AbortSignal,
  report: (event: DocumentAgentEvent) => void,
  requestId: string,
  instruction = "",
) {
  // 文档已有版本号属于事实；模型只能使用原文或用户明确提供的版本，不能补猜缺失数字。
  const versions = (text: string) =>
    text.match(/\bv\.?\d+(?:\.\d+)*\.?/gi) ?? [];
  const originalVersions = versions(document);
  const allowedVersions = new Set([
    ...originalVersions,
    ...versions(instruction),
  ]);
  const protectedCode =
    /(保留|不要修改|不改|保持).{0,12}代码块|代码块.{0,12}(不变|保留|不要修改|不改)/.test(
      instruction,
    )
      ? indexDocumentBlocks(normalizeLineEndings(document))
          .filter((block) => block.type === "code")
          .map((block) => block.text)
      : [];
  const draft = createDocumentAgentDraft(document, requestId, (next) => {
    const invented = originalVersions.length
      ? versions(next).filter((version) => !allowedVersions.has(version))
      : [];
    if (invented.length)
      throw new Error(
        `修改引入了用户未提供的版本号 ${[...new Set(invented)].join("、")}；保留原文版本 ${originalVersions.join("、")}，不要猜测补全。`,
      );
    if (protectedCode.length) {
      const remaining = indexDocumentBlocks(next)
        .filter((block) => block.type === "code")
        .map((block) => block.text);
      for (const code of protectedCode) {
        const index = remaining.indexOf(code);
        if (index < 0)
          throw new Error(
            "用户要求保留代码块，修改改变或删除了原代码；请保留完整代码块再提交",
          );
        remaining.splice(index, 1);
      }
    }
  });
  let calls = 0;
  let observed = document.length === 0;
  // 逐字符记录阅读覆盖范围，分页跳读或重复读同一页不能冒充全文已读。
  let readCoverage = new Uint8Array(draft.text().length);
  let unresolvedError = "";
  // 只有模型明确给出完成摘要且本地校验通过，才省去额外的总结请求。
  let completionSummary = "";
  const execute = async <T>(
    stage: DocumentAgentStage,
    title: string,
    action: () => T,
  ) => {
    signal.throwIfAborted();
    const operation: DocumentAgentOperation = {
      id: `${requestId}-op-${++calls}`,
      stage,
      title,
      detail: "",
      state: "running",
      startedAt: Date.now(),
    };
    report({
      requestId,
      type: "stage",
      stage,
      state: "running",
      message: title,
    });
    report({ requestId, type: "operation", operation });
    try {
      // 动作同步完成；配合执行器的串行调用，后一个工具一定看到前一个工具的结果。
      completionSummary = "";
      const fullyRead = readCoverage.every((value) => value === 1);
      const result = action();
      if (stage === "edit") {
        // 全文已读时修改内容也已由模型提供；部分阅读后的坐标失效，重新记录新草稿。
        readCoverage = new Uint8Array(draft.text().length).fill(
          fullyRead ? 1 : 0,
        );
        report({ requestId, type: "patches", patches: draft.patches() });
      }
      const detail =
        stage === "edit"
          ? `草稿已更新至第 ${draft.revision()} 版，尚未写入编辑器`
          : "已读取当前草稿";
      report({
        requestId,
        type: "operation",
        operation: { ...operation, state: "done", detail, endedAt: Date.now() },
      });
      report({
        requestId,
        type: "stage",
        stage,
        state: "done",
        message: detail,
      });
      return { ok: true, ...result };
    } catch (error) {
      signal.throwIfAborted();
      unresolvedError = error instanceof Error ? error.message : String(error);
      report({
        requestId,
        type: "operation",
        operation: {
          ...operation,
          state: "error",
          detail: unresolvedError,
          endedAt: Date.now(),
        },
      });
      // 错误明确进入同一条工具历史，绝不把失败伪装成成功或自动猜测修改。
      return { ok: false, error: unresolvedError, revision: draft.revision() };
    }
  };
  const assertObserved = (): void => {
    if (!observed) throw new Error("修改前必须先 read 当前文档");
  };
  const modified = () => {
    observed = true;
    unresolvedError = "";
    return {
      revision: draft.revision(),
      length: draft.text().length,
      issues: validateAgentDocument(draft.text()),
      message:
        "当前草稿已更新。后续 read/edit/write 均操作新正文，无需重复提交；完成后直接简短回复用户。",
    };
  };
  const read = createTool({
    id: "read",
    description:
      "读取当前文档的最新草稿（包含已完成的修改）。offset 是从 1 开始的行号，limit 是行数，默认读取至多 2000 行、12000 字符。若返回 next，直接把 next 作为下一次参数；column 用于继续读取超长行。",
    inputSchema: {
      type: "object",
      properties: {
        offset: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 2000 },
        column: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    execute: async (value: unknown) =>
      execute("locate", "读取当前文档", () => {
        const input = value as {
          offset?: number;
          limit?: number;
          column?: number;
        };
        const offset = input.offset ?? 1;
        const limit = input.limit ?? 2000;
        const column = input.column ?? 1;
        const lines = draft.text().split("\n");
        if (
          !Number.isInteger(offset) ||
          offset < 1 ||
          offset > lines.length ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 2000 ||
          !Number.isInteger(column) ||
          column < 1 ||
          column > lines[offset - 1].length + 1
        )
          throw new Error("read 的行号、行数或列号无效");
        let remaining = 12000;
        let position =
          lines
            .slice(0, offset - 1)
            .reduce((total, line) => total + line.length + 1, 0) +
          column -
          1;
        const content: string[] = [];
        let line = offset - 1;
        let next: { offset: number; column?: number } | null = null;
        // 长行也可以接着读，不能因为截断而让模型永远看不到后半段。
        for (; line < Math.min(lines.length, offset - 1 + limit); line++) {
          const start = line === offset - 1 ? column - 1 : 0;
          const available = lines[line].slice(start);
          const selected = available.slice(0, remaining);
          content.push(`${line + 1}: ${selected}`);
          // 完整读完一行时计入换行，超长行截断时只标记实际返回的字符。
          const end =
            position +
            selected.length +
            (selected.length === available.length && line < lines.length - 1
              ? 1
              : 0);
          readCoverage.fill(1, position, end);
          position = end;
          remaining -= selected.length + 1;
          if (selected.length < available.length) {
            next = { offset: line + 1, column: start + selected.length + 1 };
            break;
          }
          if (remaining <= 0) {
            line++;
            break;
          }
        }
        if (!next && line < lines.length) next = { offset: line + 1 };
        observed = true;
        return {
          revision: draft.revision(),
          totalLines: lines.length,
          length: draft.text().length,
          content: content.join("\n"),
          next,
          fullyRead: readCoverage.every((value) => value === 1),
        };
      }),
  });
  // 参数为 old_string/new_string/replace_all，去掉单文档不需要的路径。
  const editProperties = {
    old_string: { type: "string", minLength: 1 },
    new_string: { type: "string" },
    replace_all: { type: "boolean" },
  } as const;
  const summaryProperty = {
    type: "string",
    minLength: 1,
    maxLength: 1000,
    description:
      "仅在已完成用户全部要求并核对本次修改后填写简短完成摘要；还需继续工作时不填。校验通过后任务直接结束。",
  } as const;
  const complete = (summary?: string) => {
    if (
      summary?.trim() &&
      !validateAgentDocument(draft.text()).length &&
      !unresolvedError
    )
      completionSummary = summary.trim();
  };
  const edit = createTool({
    id: "edit",
    description:
      "精确修改最新草稿。多处修改优先放入 edits 数组，一次完成，最多 30 项；每项包含 old_string、new_string，可选 replace_all。按数组顺序执行，整组成功才更新。单处也可直接传 old_string/new_string。默认唯一匹配，全部替换须 replace_all:true；原文不含 read 行号，可跨段落，空 new_string 表示删除。",
    inputSchema: {
      type: "object",
      properties: {
        summary: summaryProperty,
        edits: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: {
            type: "object",
            properties: editProperties,
            required: ["old_string", "new_string"],
            additionalProperties: false,
          },
        },
        ...editProperties,
      },
      oneOf: [
        { required: ["edits"] },
        { required: ["old_string", "new_string"] },
      ],
      additionalProperties: false,
    },
    execute: async (value: unknown) =>
      execute("edit", "修改文档", () => {
        const input = value as DraftEdit & {
          edits?: DraftEdit[];
          summary?: string;
        };
        assertObserved();
        // 模型带把 Markdown 标记符过度转义（如 \*\*、\#），写入草稿前统一还原；
        // old_string 必须与草稿当前文本精确匹配，不做还原。
        const result =
          input.edits === undefined
            ? draft.edit(
                input.old_string,
                normalizeAiMarkdown(input.new_string),
                input.replace_all ?? false,
              )
            : draft.editMany(
                input.edits.map((item) => ({
                  ...item,
                  new_string: normalizeAiMarkdown(item.new_string),
                })),
              );
        const resultInfo = modified();
        complete(input.summary);
        return { ...resultInfo, replacements: result.replacements };
      }),
  });
  const write = createTool({
    id: "write",
    description:
      "新建或整体重写当前草稿，content 必须是完整 Markdown 正文，不包裹额外代码围栏。适合全文重组或空文档写作；局部修改优先 edit。现有文档必须完整阅读后才能整体覆盖；只读了部分内容时使用 edit 做局部修改。",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", maxLength: 300000 },
        summary: summaryProperty,
      },
      required: ["content"],
      additionalProperties: false,
    },
    execute: async (value: unknown) =>
      execute("edit", "写入文档草稿", () => {
        const input = value as { content: string; summary?: string };
        assertObserved();
        if (!readCoverage.every((value) => value === 1))
          throw new Error(
            "整体写入前必须完整 read 当前草稿，不能丢弃尚未读取的正文；局部修改请使用 edit",
          );
        // 整体重写同样先还原过度转义，与 edit 保持一致。
        draft.write(normalizeAiMarkdown(input.content));
        const result = modified();
        complete(input.summary);
        return result;
      }),
  });
  return {
    tools: { read, edit, write },
    draft,
    getCompletionSummary: () => completionSummary,
    getUnresolvedError: () => unresolvedError,
    recordError: (message: string) => {
      unresolvedError = message;
    },
    // 短文档直接给模型完整正文，等同成功读取，省去一次网络往返。
    initialContext: () => {
      if (draft.text().length <= 12000) {
        observed = true;
        readCoverage.fill(1);
        return {
          revision: 0,
          length: draft.text().length,
          complete: true,
          content: draft.text(),
          protectedVersions: originalVersions,
        };
      }
      return {
        revision: 0,
        length: draft.text().length,
        totalLines: draft.text().split("\n").length,
        complete: false,
        message: "请用 read 阅读当前文档；按返回的 next 继续读取。",
      };
    },
  };
}
