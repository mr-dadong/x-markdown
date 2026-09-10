/** 行级 diff：建议审阅卡用 unified 视图展示删除行与新增行。 */

export interface DiffLine {
    type: 'context' | 'add' | 'remove'
    text: string
}

// 按行 LCS 动态规划生成 unified diff。
// 建议片段只有几十行，O(n*m) 的表格完全够用，不需要启发式简化。
export const diffLines = (before: string, after: string): DiffLine[] => {
    const a = before === '' ? [] : before.split('\n')
    const b = after === '' ? [] : after.split('\n')
    const rows = a.length
    const cols = b.length
    // table[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
    const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
    for (let i = rows - 1; i >= 0; i--) {
        for (let j = cols - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
        }
    }
    const lines: DiffLine[] = []
    let i = 0
    let j = 0
    while (i < rows && j < cols) {
        if (a[i] === b[j]) {
            lines.push({ type: 'context', text: a[i] })
            i++
            j++
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            // 向下走更优：当前旧行在新增内容里没有对应行，属于删除
            lines.push({ type: 'remove', text: a[i] })
            i++
        } else {
            lines.push({ type: 'add', text: b[j] })
            j++
        }
    }
    // 收尾：剩余的旧行全部删除，剩余的新行全部新增
    while (i < rows) { lines.push({ type: 'remove', text: a[i] }); i++ }
    while (j < cols) { lines.push({ type: 'add', text: b[j] }); j++ }
    return lines
}
