import { computed, onScopeDispose, ref, watch } from 'vue';
import type { DocumentAgentApi, DocumentPatch } from '../types/documentAgent';
import { applyDocumentPatches, validateAgentDocument } from '../utils/documentAgent';

/** 接受修改通过编辑器事务写入，任务本身不会直接保存文件。 */
export interface DocumentAgentOptions {
  getDocument: () => string;
  getDocumentId: () => number | null;
  getSelection: () => string;
  getModel: () => string | null;
  applyDocument: (expected: string, next: string) => void;
}
type TaskStatus = 'idle' | 'running' | 'review' | 'done' | 'cancelled' | 'error' | 'conflict';
type ReviewPatch = DocumentPatch & { decision: 'pending' | 'accepted' | 'rejected' };

/** API 参数方便用可控事件测试停止、迟到响应和编辑冲突。 */
export function useDocumentAgent(options: DocumentAgentOptions, api: DocumentAgentApi = window.electronAPI.documentAgent) {
  const status = ref<TaskStatus>('idle');
  const instruction = ref('');
  const response = ref('');
  const reasoning = ref('');
  // 最近收到的事件决定状态条显示“思考、执行或整理结果”。
  const phase = ref<'thinking' | 'executing' | 'writing'>('thinking');
  const logs = ref<string[]>([]);
  const patches = ref<ReviewPatch[]>([]);
  const issues = ref<string[]>([]);
  const checkTarget = ref('全部建议应用后');
  const error = ref('');
  const requestId = ref('');
  // 等待 IPC 真正结束再允许重发，避免取消与新请求抢占后端。
  const settling = ref(false);
  let original = '';
  let expected = '';
  let documentId: number | null = null;
  let ownWrite = false;
  const running = computed(() => status.value === 'running');
  const pending = computed(() => patches.value.filter(patch => patch.decision === 'pending'));
  const accepted = computed(() => patches.value.filter(patch => patch.decision === 'accepted'));
  const canReview = computed(() => status.value === 'review' || status.value === 'done');
  const canStart = computed(() => !running.value && !settling.value && (pending.value.length === 0 || !canReview.value));

  const cancel = (): void => {
    if (!requestId.value) return;
    api.cancel(requestId.value);
    requestId.value = '';
    status.value = 'cancelled';
    logs.value.push('任务已停止，本轮建议不可应用');
  };
  // flush: sync 捕获“修改后又撤销”的变化，不能仅靠最终字符串相等判定版本。
  const offWatch = watch([options.getDocument, options.getDocumentId], () => {
    if (ownWrite || status.value === 'idle') return;
    if (requestId.value) api.cancel(requestId.value);
    requestId.value = '';
    status.value = 'conflict';
    error.value = '文档已变化，本轮修改和任务撤销已停用。请重新读取并执行，已有正文不会被覆盖。';
  }, { flush: 'sync' });

  const start = async (text: string): Promise<boolean> => {
    if (!canStart.value || !text.trim()) return false;
    if (options.getDocumentId() === null) {
      error.value = '请先打开文档';
      return false;
    }
    original = options.getDocument();
    expected = original;
    documentId = options.getDocumentId();
    instruction.value = text.trim();
    response.value = '';
    reasoning.value = '';
    phase.value = 'thinking';
    logs.value = [];
    patches.value = [];
    issues.value = [];
    checkTarget.value = '全部建议应用后';
    error.value = '';
    status.value = 'running';
    settling.value = true;
    const id = crypto.randomUUID();
    requestId.value = id;
    try {
      const model = options.getModel();
      await api.invoke({ requestId: id, instruction: instruction.value, document: original,
        selection: options.getSelection(), ...(model ? { model } : {}) });
      // 没有完成事件就不能显示成功。
      if (requestId.value === id) throw new Error('任务连接已结束，但没有收到完成结果');
    } catch (failure) {
      if (requestId.value === id) {
        requestId.value = '';
        status.value = 'error';
        error.value = failure instanceof Error ? failure.message : String(failure);
      }
    } finally {
      settling.value = false;
    }
    return canReview.value;
  };

  const offEvent = api.onEvent(event => {
    if (event.requestId !== requestId.value) return;
    if (event.type === 'progress') {
      logs.value.push(event.message);
      phase.value = 'executing';
    }
    if (event.type === 'reasoning') {
      reasoning.value += event.text;
      phase.value = 'thinking';
    }
    if (event.type === 'text') {
      response.value += event.text;
      phase.value = 'writing';
    }
    if (event.type === 'patch') patches.value.push({ ...event.patch, decision: 'pending' });
    if (event.type === 'done') {
      issues.value = event.issues;
      status.value = pending.value.length ? 'review' : 'done';
      requestId.value = '';
    }
    if (event.type === 'error') {
      status.value = 'error';
      error.value = event.message;
      requestId.value = '';
    }
  });

  const write = (next: string): boolean => {
    try {
      if (options.getDocumentId() !== documentId || options.getDocument() !== expected) throw new Error('文档已变化，请重新执行任务');
      ownWrite = true;
      options.applyDocument(expected, next);
      if (options.getDocument() !== next) throw new Error('编辑器未完成写入，请重新读取文档');
      expected = next;
      issues.value = validateAgentDocument(next);
      checkTarget.value = '当前文档';
      return true;
    } catch (failure) {
      status.value = 'conflict';
      error.value = failure instanceof Error ? failure.message : String(failure);
      return false;
    } finally {
      ownWrite = false;
    }
  };
  const accept = (id?: string): void => {
    if (!canReview.value) return;
    const selected = pending.value.filter(patch => id === undefined || patch.id === id);
    if (!selected.length) return;
    try {
      const next = applyDocumentPatches(original, [...accepted.value, ...selected]);
      if (!write(next)) return;
      selected.forEach(patch => { patch.decision = 'accepted'; });
      logs.value.push(`已接受 ${selected.length} 处修改，可撤销本次任务`);
      if (!pending.value.length) status.value = 'done';
    } catch (failure) {
      status.value = 'error';
      error.value = failure instanceof Error ? failure.message : String(failure);
    }
  };
  const reject = (id?: string): void => {
    if (!canReview.value) return;
    pending.value.filter(patch => id === undefined || patch.id === id).forEach(patch => { patch.decision = 'rejected'; });
    // 拒绝后重新检查真正保留的内容，不能沿用全部建议应用后的检查结果。
    issues.value = validateAgentDocument(expected);
    checkTarget.value = '当前文档';
    if (!pending.value.length) status.value = 'done';
  };
  const undo = (): void => {
    if (!canReview.value || !accepted.value.length || !write(original)) return;
    accepted.value.forEach(patch => { patch.decision = 'pending'; });
    status.value = 'review';
    logs.value.push('已撤销本次任务接受的全部修改');
  };
  onScopeDispose(() => { cancel(); offEvent(); offWatch(); });
  return { status, instruction, response, reasoning, phase, logs, patches, issues, checkTarget, error, running, settling, pending, accepted, canReview, canStart, start, cancel, accept, reject, undo };
}
