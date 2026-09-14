/**
 * 反斜杠转义判断工具。
 *
 * Markdown 里「某个字符是否已被反斜杠转义」的规则是统一的：
 * 向前数连续的反斜杠，奇数个表示已转义、偶数个表示未转义。
 * 表格竖线处理、行内代码配对等多处都需要这条规则，
 * 之前各自实现了一遍，这里收敛成唯一来源，避免改一漏多。
 */

/**
 * 判断指定位置上的字符是否已被反斜杠转义（向前数连续反斜杠，奇数即转义）。
 * @param text 完整文本
 * @param index 待判断字符的下标
 */
export const isEscapedAt = (text: string, index: number): boolean => {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
};

/**
 * 逐字符扫描文本，对满足条件的字符补一个转义反斜杠。
 *
 * 用于「只转义某些位置上的目标字符」的场景：调用方通过 shouldEscape 决定
 * 当前位置是否需要转义，是否需要转义只在字符尚未被转义时生效。
 * 连续反斜杠的计账与 isEscapedAt 保持一致，两者可安全混用在同一段文本上。
 *
 * @param text 原始文本
 * @param target 需要转义的目标字符，例如表格的 "|"
 * @param shouldEscape 判断第 index 个字符是否需要转义
 */
export const escapeTargetCharacter = (
  text: string,
  target: string,
  shouldEscape: (index: number) => boolean,
): string => {
  let result = "";
  let consecutiveBackslashes = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (
      character === target &&
      consecutiveBackslashes % 2 === 0 &&
      shouldEscape(index)
    ) {
      result += "\\";
    }
    result += character;
    // 目标字符会打断反斜杠连击；其它字符按是否为反斜杠累计。
    consecutiveBackslashes = character === "\\" ? consecutiveBackslashes + 1 : 0;
  }

  return result;
};
