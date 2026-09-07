import { ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../../src/constants/ipcChannels';
import type { DocumentAgentEvent, DocumentAgentRequest } from '../../../src/types/documentAgent';
import { getAiSettings } from '../aiSettings';
import { buildModelConfig } from '../mastra';
import { runDocumentAgent } from '../documentAgentRun';

/** 主进程只处理当前快照，不向模型开放文件系统或任意 IPC。 */
export function registerDocumentAgentIpc(validateSender: (event: IpcMainInvokeEvent | IpcMainEvent) => void): void {
  const active = new Map<number, { requestId: string; controller: AbortController }>();
  ipcMain.handle(IPC_CHANNELS.documentAgentInvoke, async (event, request: DocumentAgentRequest) => {
    validateSender(event);
    if (!request || typeof request.requestId !== 'string' || !request.requestId ||
        typeof request.instruction !== 'string' || !request.instruction.trim() || request.instruction.length > 12000 ||
        typeof request.document !== 'string' || request.document.length > 300000 ||
        typeof request.selection !== 'string' || request.selection.length > 12000 ||
        (request.model !== undefined && (typeof request.model !== 'string' || !request.model.trim()))) throw new Error('Agent 请求无效：文档最多 30 万字符，指令和选区最多 12000 字符');
    const sender = event.sender;
    if (active.has(sender.id)) throw new Error('已有文档任务正在执行，请先停止');
    const controller = new AbortController();
    active.set(sender.id, { requestId: request.requestId, controller });
    const destroyed = (): void => controller.abort();
    sender.once('destroyed', destroyed);
    const report = (payload: DocumentAgentEvent): void => {
      if (!sender.isDestroyed() && !controller.signal.aborted) sender.send(IPC_CHANNELS.documentAgentEvent, payload);
    };
    try {
      const settings = await getAiSettings();
      if (!settings.enabled) throw new Error('请先在设置中启用 AI');
      // 分阶段执行器负责请求、无响应和任务预算，IPC 仅管理生命周期。
      await runDocumentAgent(request, {
        model: buildModelConfig(settings, request.model) as Parameters<typeof runDocumentAgent>[1]['model'],
        timeoutMs: settings.timeoutMs, maxTokens: settings.maxTokens, temperature: settings.temperature,
        controller, report,
      });
    } catch (error) {
      // 用户取消的事件由前端处理；超时和其他错误必须明确显示。
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      // 主动结束后台循环，避免前端显示失败后仍有模型或工具继续工作。
      if (!controller.signal.aborted) controller.abort(reason);
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.documentAgentEvent, { requestId: request.requestId, type: 'error', message: reason instanceof Error ? reason.message : String(reason) } satisfies DocumentAgentEvent);
    } finally {
      sender.removeListener('destroyed', destroyed);
      active.delete(sender.id);
    }
  });
  ipcMain.on(IPC_CHANNELS.documentAgentCancel, (event, requestId: string) => {
    validateSender(event);
    const task = active.get(event.sender.id);
    if (task?.requestId === requestId) task.controller.abort(new Error('任务已停止'));
  });
}
