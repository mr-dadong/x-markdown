import type { DocumentPatch } from "../../src/types/documentAgent";
import { applyDocumentPatches } from "../../src/utils/documentAgent";
import { fingerprintDocument } from "../../src/utils/documentAgentBlocks";
import { applyLiteralEdit, normalizeLineEndings } from "./literalEdit";

/** 单处字面替换参数，与模型工具字段一致。 */
export interface DraftEdit {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/** 保存草稿字符对应的原文位置，让连续修改最后仍能生成原文坐标的审阅卡。 */
export function createDocumentAgentDraft(
  original: string,
  requestId: string,
  validateContent: (text: string) => void = () => {},
) {
  let text = normalizeLineEndings(original);
  const base = text;
  const baseVersion = fingerprintDocument(original);
  let origins = Array.from({ length: text.length }, (_, index) => index);
  let revision = 0;
  // 边界表将 LF 草稿位置还原为原文位置，未修改部分的 CRLF 不会被重写。
  const boundaries = [0];
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < original.length; index++) {
    if (original[index] === "\r" && original[index + 1] === "\n") {
      index++;
      crlf++;
    } else if (original[index] === "\n") lf++;
    boundaries.push(index + 1);
  }
  const restore = (value: string) =>
    crlf > lf ? value.replaceAll("\n", "\r\n") : value;
  // 新字符记为 -1，保留字符仍指向初始原文；二次修改不会产生重叠补丁。
  const replaceOrigins = (
    start: number,
    end: number,
    content: string,
  ): void => {
    origins = origins
      .slice(0, start)
      .concat(new Array<number>(content.length).fill(-1), origins.slice(end));
  };
  const assertSize = (value: string): void => {
    if (value.length > 300000)
      throw new Error("草稿最多 30 万字符，请缩小修改范围");
  };
  // 先在局部变量里完成全部替换；任何一项失败时，当前草稿和来源表都不改变。
  const editMany = (edits: DraftEdit[]) => {
    if (!edits.length || edits.length > 30)
      throw new Error("一次 edit 提供 1–30 处修改");
    let nextText = text;
    let nextOrigins = origins;
    let replacements = 0;
    for (const edit of edits) {
      const result = applyLiteralEdit(
        nextText,
        edit.old_string,
        edit.new_string,
        edit.replace_all ?? false,
      );
      assertSize(result.content);
      const before = normalizeLineEndings(edit.old_string);
      const after = normalizeLineEndings(edit.new_string);
      const updatedOrigins = new Array<number>(result.content.length).fill(-1);
      let source = 0;
      let target = 0;
      // 每项替换只扫描一次来源表，大量 replace_all 不会反复复制整篇文档。
      for (
        let index = nextText.indexOf(before);
        index >= 0;
        index = nextText.indexOf(before, index + before.length)
      ) {
        while (source < index) updatedOrigins[target++] = nextOrigins[source++];
        source += before.length;
        target += after.length;
      }
      while (source < nextOrigins.length)
        updatedOrigins[target++] = nextOrigins[source++];
      nextOrigins = updatedOrigins;
      nextText = result.content;
      replacements += result.replacements;
    }
    validateContent(nextText);
    text = nextText;
    origins = nextOrigins;
    revision++;
    return { revision, replacements };
  };
  return {
    text: () => text,
    revision: () => revision,
    editMany,
    edit: (old_string: string, new_string: string, replace_all: boolean) =>
      editMany([{ old_string, new_string, replace_all }]),
    write(content: string) {
      const next = normalizeLineEndings(content);
      assertSize(next);
      validateContent(next);
      if (next === text) throw new Error("草稿内容没有变化，无需再次写入");
      // 保留未变化的首尾来源，减少全文写入时审阅卡中的无关正文。
      let start = 0;
      while (
        start < text.length &&
        start < next.length &&
        text[start] === next[start]
      )
        start++;
      let end = text.length;
      let nextEnd = next.length;
      while (
        end > start &&
        nextEnd > start &&
        text[end - 1] === next[nextEnd - 1]
      ) {
        end--;
        nextEnd--;
      }
      replaceOrigins(start, end, next.slice(start, nextEnd));
      text = next;
      revision++;
      return { revision };
    },
    patches(): DocumentPatch[] {
      const patches: DocumentPatch[] = [];
      let sourceStart = 0;
      let draftStart = 0;
      const append = (sourceEnd: number, draftEnd: number): void => {
        const before = original.slice(
          boundaries[sourceStart],
          boundaries[sourceEnd],
        );
        const content = text.slice(draftStart, draftEnd);
        const after = restore(content);
        if (normalizeLineEndings(before) !== content)
          patches.push({
            id: `${requestId}-${patches.length + 1}`,
            baseVersion,
            start: boundaries[sourceStart],
            end: boundaries[sourceEnd],
            before,
            after,
            reason: "根据文档目标调整内容",
          });
      };
      // 未改字符是天然的分隔点，不需要在整篇长文档上运行平方复杂度的 diff。
      for (let index = 0; index < origins.length; index++) {
        const source = origins[index];
        if (source < 0) continue;
        if (source > sourceStart || index > draftStart) append(source, index);
        sourceStart = source + 1;
        draftStart = index + 1;
      }
      append(base.length, text.length);
      // 发布前验证全部建议，保证沿用原有接受、拒绝与撤销接口。
      if (
        normalizeLineEndings(applyDocumentPatches(original, patches)) !== text
      )
        throw new Error("草稿与审阅差异不一致");
      return patches;
    },
  };
}
