/** 流式 Markdown 分块渲染的切分工具：聊天与 Agent 时间线共用同一套逻辑。 */

/** 已完成块携带稳定 id，渲染后 DOM 节点复用不重建。 */
export interface StreamBlock {
    id: number
    html: string
}

// 按空行与代码围栏边界切分流式文本，返回 [已完成块..., 尾块]。
// 尾块可能是一段未写完的正文，也可能是未闭合的 ``` 围栏。
export const splitStreamBlocks = (text: string): { done: string[]; tail: string } => {
    const done: string[] = []
    let current = ''
    let inFence = false
    for (const line of text.split('\n')) {
        const isFence = /^\s*```/.test(line)
        if (isFence) {
            if (!inFence) {
                if (current) {
                    done.push(current)
                    current = ''
                }
                current = line
                inFence = true
            } else {
                current += '\n' + line
                done.push(current)
                current = ''
                inFence = false
            }
        } else if (!inFence && line.trim() === '') {
            if (current) {
                done.push(current)
                current = ''
            }
        } else {
            current += (current ? '\n' : '') + line
        }
    }
    return { done, tail: current }
}
