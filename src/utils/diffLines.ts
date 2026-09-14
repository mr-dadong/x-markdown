/** 行级 diff：建议审阅卡用 unified 视图展示删除行与新增行。 */

import { lcsMatches } from "./longestCommonSubsequence";

export interface DiffLine {
    type: 'context' | 'add' | 'remove'
    text: string
}

// 按行 LCS 生成 unified diff。
// 建议片段只有几十行，O(n*m) 的表格完全够用，不需要启发式简化。
export const diffLines = (before: string, after: string): DiffLine[] => {
    const a = before === '' ? [] : before.split('\n')
    const b = after === '' ? [] : after.split('\n')
    const rows = a.length
    const cols = b.length
    // 公共子序列匹配由统一工具计算，这里只负责把结果翻译成 diff 行。
    const matches = lcsMatches(a, b)

    const lines: DiffLine[] = []
    let i = 0
    let j = 0
    let matchIndex = 0
    while (matchIndex < matches.length) {
        const [matchRow, matchCol] = matches[matchIndex]
        // 匹配点之前的内容：旧行记为删除、新行记为新增。
        while (i < matchRow) { lines.push({ type: 'remove', text: a[i] }); i++ }
        while (j < matchCol) { lines.push({ type: 'add', text: b[j] }); j++ }
        // 匹配点本身记为上下文行。
        lines.push({ type: 'context', text: a[matchRow] })
        i = matchRow + 1
        j = matchCol + 1
        matchIndex += 1
    }
    // 收尾：剩余的旧行全部删除，剩余的新行全部新增。
    while (i < rows) { lines.push({ type: 'remove', text: a[i] }); i++ }
    while (j < cols) { lines.push({ type: 'add', text: b[j] }); j++ }
    return lines
}
