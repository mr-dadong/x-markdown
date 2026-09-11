import { computed, onScopeDispose, ref, watch } from 'vue';
import type { DocumentAgentApi, DocumentAgentEvent, DocumentAgentGoal, DocumentAgentOperation, DocumentAgentStage, DocumentAgentTimelineEntry, DocumentPatch } from '../types/documentAgent';
import { applyDocumentPatches, validateAgentDocument } from '../utils/documentAgent';
import { fingerprintDocument } from '../utils/documentAgentBlocks';

/** 接受修改通过编辑器事务写入，任务本身不会直接保存文件。 */
export interface DocumentAgentOptions {
  getDocument: () => string;
  getDocumentId: () => number | null;
  getSelection: () => string;
  getModel: () => string | null;
  applyDocument: (expected: string, next: string) => void;
}
type TaskStatus = 'idle' | 'running' | 'stopping' | 'review' | 'done' | 'cancelled' | 'error' | 'conflict';
type ReviewPatch = DocumentPatch & { decision: 'pending' | 'accepted' | 'rejected' };

/** API 参数方便用可控事件测试停止、迟到响应和编辑冲突。 */
export function useDocumentAgent(options: DocumentAgentOptions, api: DocumentAgentApi = window.electronAPI.documentAgent) {
  const status = ref<TaskStatus>('idle');
  const instruction = ref('');
  const response = ref('');
  const reasoning = ref('');
  const draft = ref('');
  // 最近收到的事件决定状态条显示“思考、执行或整理结果”。
  const phase = ref<'thinking' | 'executing' | 'writing'>('thinking');
  // 当前动作单独置顶，避免用户只能从内部阶段或思考文字猜测 Agent 在做什么。
  const currentActionTitle = ref('');
  const currentActionDetail = ref('');
  const logs = ref<string[]>([]);
  // 阶段、操作与目标分别存储，模型输出文字不会改变阶段。
  const stages = ref<Array<{ id: DocumentAgentStage; title: string; state: 'pending' | 'running' | 'done' | 'interrupted' | 'skipped'; detail: string }>>([]);
  const operations = ref<DocumentAgentOperation[]>([]);
  const goals = ref<DocumentAgentGoal[]>([]);
  const outcome = ref<'complete' | 'incomplete' | null>(null);
  const startedAt = ref(0);
  const endedAt = ref(0);
  const step = ref(0);
  const maxSteps = ref(0);
  const taskMs = ref(0);
  const budgetMessage = ref('');
  const batch = ref(0);
  const totalBatches = ref(0);
  const completedBlocks = ref(0);
  const remainingBlocks = ref(0);
  const truncationRecoveries = ref(0);

  const patches = ref<ReviewPatch[]>([]);
  // 时间线按事件到达顺序排列，思考/工具/回复/建议 interleaving 展示。
  const timeline = ref<DocumentAgentTimelineEntry[]>([]);
  let timelineSeq = 0;
  const issues = ref<string[]>([]);
  const checkTarget = ref('全部建议应用后');
  const error = ref('');
  // 完成事件携带的说明（如达到预算、任务停止）：属于部分完成提示，不占用红色错误位。
  const partialMessage = ref('');
  const requestId = ref('');
  // 等待 IPC 真正结束再允许重发，避免取消与新请求抢占后端。
  const settling = ref(false);
  let original = '';
  let expected = '';
  let documentId: number | null = null;
  let documentVersion = '';
  let ownWrite = false;
  const running = computed(() => status.value === 'running' || status.value === 'stopping');
  const pending = computed(() => patches.value.filter(patch => patch.decision === 'pending'));
  const accepted = computed(() => patches.value.filter(patch => patch.decision === 'accepted'));
  const canReview = computed(() => status.value === 'review' || status.value === 'done');
  const canStart = computed(() => !running.value && !settling.value && (pending.value.length === 0 || !canReview.value));

  // 终止时保留已收到的结果，将尚在执行的操作标记为中断。
  const interruptProgress = (message: string): void => {
    if (!endedAt.value) endedAt.value = Date.now();
    stages.value.forEach(stage => {
      if (stage.state === 'running') { stage.state = 'interrupted'; stage.detail = message; }
    });
    operations.value.forEach(operation => {
      if (operation.state === 'running') { operation.state = 'error'; operation.detail = message; operation.endedAt = Date.now(); }
    });
  };

  const cancel = (): void => {
    if (!requestId.value) return;
    api.cancel(requestId.value);
    status.value = 'stopping';
    interruptProgress('正在停止任务');
    logs.value.push('正在停止后台任务，结束后将保留已验证建议');
  };

  // 清除只重置 Agent 的本轮界面记录，已经接受并写入编辑器的内容保持不变。
  const clear = (): boolean => {
    if (running.value || settling.value) return false;
    status.value = 'idle';
    instruction.value = '';
    response.value = '';
    reasoning.value = '';
    draft.value = '';
    phase.value = 'thinking';
    currentActionTitle.value = '';
    currentActionDetail.value = '';
    logs.value = [];
    timeline.value = [];
    timelineSeq = 0;
    stages.value = [];
    operations.value = [];
    goals.value = [];
    outcome.value = null;
    startedAt.value = 0;
    endedAt.value = 0;
    step.value = 0;
    maxSteps.value = 0;
    taskMs.value = 0;
    budgetMessage.value = '';
    batch.value = 0;
    totalBatches.value = 0;
    completedBlocks.value = 0;
    remainingBlocks.value = 0;
    truncationRecoveries.value = 0;
    patches.value = [];
    issues.value = [];
    checkTarget.value = '全部建议应用后';
    error.value = '';
    partialMessage.value = '';
    requestId.value = '';
    original = '';
    expected = '';
    documentId = null;
    documentVersion = '';
    ownWrite = false;
    return true;
  };
  // flush: sync 捕获“修改后又撤销”的变化，不能仅靠最终字符串相等判定版本。
  const offWatch = watch([options.getDocument, options.getDocumentId], () => {
    if (ownWrite || status.value === 'idle') return;
    if (requestId.value) api.cancel(requestId.value);
    requestId.value = '';
    status.value = 'conflict';
    interruptProgress('文档已变化');
    error.value = '文档已变化，本轮修改和任务撤销已停用。请重新读取并执行，已有正文不会被覆盖。';
  }, { flush: 'sync' });

  const start = async (text: string): Promise<boolean> => {
    if (!canStart.value || !text.trim()) return false;
    if (options.getDocumentId() === null) {
      error.value = '请先打开文档';
      return false;
    }
    original = options.getDocument();
    documentVersion = fingerprintDocument(original);
    expected = original;
    documentId = options.getDocumentId();
    instruction.value = text.trim();
    response.value = '';
    reasoning.value = '';
    draft.value = '';
    phase.value = 'thinking';
    currentActionTitle.value = '正在理解你的要求';
    currentActionDetail.value = '准备文档快照并建立处理范围';
    stages.value = [
      { id: 'understand', title: '理解目标', state: 'running', detail: '正在准备任务' },
      { id: 'locate', title: '定位内容', state: 'pending', detail: '' },
      { id: 'edit', title: '生成修改', state: 'pending', detail: '' },
      { id: 'check', title: '检查结果', state: 'pending', detail: '' },
      { id: 'review', title: '审阅修改', state: 'pending', detail: '' },
    ];
    operations.value = [];
    goals.value = [];
    timeline.value = [];
    timelineSeq = 0;
    outcome.value = null;
    startedAt.value = Date.now();
    endedAt.value = 0;
    step.value = 0;
    maxSteps.value = 0;
    taskMs.value = 0;
    budgetMessage.value = '';
    batch.value = 0;
    totalBatches.value = 0;
    completedBlocks.value = 0;
    remainingBlocks.value = 0;
    truncationRecoveries.value = 0;
    logs.value = [];
    patches.value = [];
    issues.value = [];
    checkTarget.value = '全部建议应用后';
    error.value = '';
    partialMessage.value = '';
    status.value = 'running';
    settling.value = true;
    const id = crypto.randomUUID();
    requestId.value = id;
    try {
      const model = options.getModel();
      const result = await api.invoke({
        requestId: id, instruction: instruction.value, document: original, documentVersion,
        selection: options.getSelection(), ...(model ? { model } : {})
      });
      // 最终结果由 invoke 直接返回，事件即使稍后到达也不会误判任务失败。
      handleEvent(result);
      if (requestId.value === id) throw new Error('任务连接已结束，但没有收到完成结果');
    } catch (failure) {
      if (requestId.value === id) {
        requestId.value = '';
        status.value = 'error';
        error.value = failure instanceof Error ? failure.message : String(failure);
        interruptProgress(error.value);
      }
    } finally {
      settling.value = false;
    }
    return canReview.value;
  };

  // 思考/回复增量追加到同一条目，避免每个 delta 都新建卡片。
  const appendTimelineText = (kind: 'thinking' | 'text', text: string): void => {
    const last = timeline.value[timeline.value.length - 1];
    if (last && last.kind === kind) { last.text += text; return; }
    timeline.value.push({ id: `${kind}-${timelineSeq++}`, kind, text });
  };
  // 从后往前找仍在执行的工具行，progress 与 draft 归属到它。
  const runningToolEntry = (): Extract<DocumentAgentTimelineEntry, { kind: 'tool' }> | undefined => {
    for (let index = timeline.value.length - 1; index >= 0; index--) {
      const entry = timeline.value[index];
      if (entry.kind === 'tool' && entry.operation.state === 'running') return entry;
    }
    return undefined;
  };

  function handleEvent(event: DocumentAgentEvent): void {
    if (event.requestId !== requestId.value) return;
    // 停止请求发出后忽略迟到的流增量，只等待主进程交付最终完成或错误结果。
    if (status.value === 'stopping' && event.type !== 'done' && event.type !== 'error') return;
    if (event.type === 'stage') {
      const stage = stages.value.find(item => item.id === event.stage);
      if (stage) { stage.state = event.state; stage.detail = event.message; }
    }
    if (event.type === 'operation') {
      const index = operations.value.findIndex(item => item.id === event.operation.id);
      if (index === -1) operations.value.push(event.operation);
      else operations.value[index] = event.operation;
      // 工具行保持在首次出现的位置，后续状态更新原地替换；结束后参数流不再展示。
      const entry = timeline.value.find(item => item.kind === 'tool' && item.operation.id === event.operation.id);
      if (entry && entry.kind === 'tool') {
        entry.operation = event.operation;
        if (event.operation.state !== 'running') entry.draft = '';
      } else {
        timeline.value.push({ id: `tool-${event.operation.id}`, kind: 'tool', operation: event.operation, logs: [], draft: '' });
      }
    }
    if (event.type === 'goals') goals.value = event.goals;
    if (event.type === 'budget') {
      step.value = event.step;
      maxSteps.value = event.maxSteps;
      taskMs.value = event.taskMs;
      budgetMessage.value = event.message;
    }
    if (event.type === 'activity') {
      currentActionTitle.value = event.title;
      currentActionDetail.value = event.detail;
      phase.value = 'executing';
    }
    if (event.type === 'progress') {
      logs.value.push(event.message);
      phase.value = 'executing';
      if (event.message.startsWith('工具参数需要修正')) {
        currentActionTitle.value = '正在修正修改参数';
        currentActionDetail.value = `${event.message.replace('工具参数需要修正：', '')}；下一轮将按要求重新提交`;
      }
      // 进展归入正在执行的工具行；没有归属工具时作为独立提示行。
      const tool = runningToolEntry();
      if (tool) tool.logs.push(event.message);
      else timeline.value.push({ id: `notice-${timelineSeq++}`, kind: 'notice', message: event.message });
    }
    if (event.type === 'reasoning') {
      reasoning.value += event.text;
      phase.value = 'thinking';
      appendTimelineText('thinking', event.text);
    }
    if (event.type === 'text') {
      response.value += event.text;
      phase.value = 'writing';
      appendTimelineText('text', event.text);
    }
    if (event.type === 'batch') {
      batch.value = event.batch;
      totalBatches.value = event.totalBatches;
      completedBlocks.value = event.completedBlocks;
      remainingBlocks.value = event.remainingBlocks;
      truncationRecoveries.value = event.truncationRecoveries;
      if (event.message) budgetMessage.value = event.message;
    }
    if (event.type === 'draft') {
      draft.value = event.text;
      phase.value = 'writing';
      const tool = runningToolEntry();
      if (tool) tool.draft = event.text;
    }
    if (event.type === 'patches') {
      // 运行期间禁止接受建议，因此可整体替换快照，移除已经撤回的差异。
      if (event.patches.some(patch => patch.baseVersion !== documentVersion)) {
        api.cancel(requestId.value);
        status.value = 'conflict';
        error.value = 'Agent 返回的修改不属于当前文档版本，请重新执行任务。';
        interruptProgress(error.value);
        requestId.value = '';
        return;
      }
      patches.value = event.patches.map(patch => ({ ...patch, decision: 'pending' }));
      timeline.value = timeline.value.filter(item => item.kind !== 'patch');
      for (const patch of event.patches) timeline.value.push({ id: `patch-${patch.id}`, kind: 'patch', patchId: patch.id });
      draft.value = '';
    }
    if (event.type === 'patch') {
      if (event.patch.baseVersion !== documentVersion) {
        api.cancel(requestId.value);
        status.value = 'conflict';
        error.value = 'Agent 返回的修改不属于当前文档版本，请重新执行任务。';
        interruptProgress(error.value);
        requestId.value = '';
        return;
      }
      draft.value = '';
      // 建议已到达，正在接收的参数流随之结束。
      const drafting = runningToolEntry();
      if (drafting) drafting.draft = '';
      // 修订沿用同一建议 ID，替换旧预览而不是追加重复卡片。
      const index = patches.value.findIndex(patch => patch.id === event.patch.id);
      const patch: ReviewPatch = { ...event.patch, decision: 'pending' };
      if (index === -1) patches.value.push(patch);
      else patches.value[index] = patch;
      // 建议卡按首次到达位置入列，修订不重复追加。
      if (!timeline.value.some(item => item.kind === 'patch' && item.patchId === event.patch.id)) {
        timeline.value.push({ id: `patch-${event.patch.id}`, kind: 'patch', patchId: event.patch.id });
      }
      const check = stages.value.find(stage => stage.id === 'check');
      if (check) { check.state = 'pending'; check.detail = '修改已更新，等待最终检查'; }
    }
    if (event.type === 'done') {
      issues.value = event.issues;
      outcome.value = event.outcome ?? 'complete';
      // 完成即不是失败：携带的说明交给中性提示展示，红色错误位只留给真正的错误。
      partialMessage.value = event.message ?? '';
      error.value = '';
      endedAt.value = Date.now();
      stages.value.forEach(stage => {
        if (stage.state === 'pending') { stage.state = 'skipped'; stage.detail = '本次未执行此阶段'; }
      });
      const review = stages.value.find(stage => stage.id === 'review');
      if (review) { review.state = pending.value.length ? 'running' : 'done'; review.detail = pending.value.length ? '等待你接受或拒绝建议' : '没有待应用的修改'; }
      status.value = pending.value.length ? 'review' : 'done';
      requestId.value = '';
      currentActionTitle.value = '';
      currentActionDetail.value = '';
    }
    if (event.type === 'error') {
      status.value = status.value === 'stopping' ? 'cancelled' : 'error';
      error.value = event.message;
      interruptProgress(event.message);
      requestId.value = '';
      currentActionTitle.value = '';
      currentActionDetail.value = '';
    }
  }
  const offEvent = api.onEvent(handleEvent);

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
  // 审阅进度跟随用户的真实决定，全部处理后才完成这一阶段。
  const offReviewWatch = watch([status, () => pending.value.length], () => {
    if (!canReview.value) return;
    const review = stages.value.find(stage => stage.id === 'review');
    if (review) { review.state = pending.value.length ? 'running' : 'done'; review.detail = pending.value.length ? `还有 ${pending.value.length} 处待审阅` : '所有建议已处理'; }
  });
  onScopeDispose(() => { offReviewWatch(); cancel(); offEvent(); offWatch(); });
  return { stages, operations, goals, outcome, startedAt, endedAt, step, maxSteps, taskMs, budgetMessage, batch, totalBatches, completedBlocks, remainingBlocks, truncationRecoveries, currentActionTitle, currentActionDetail, status, instruction, response, reasoning, draft, phase, logs, timeline, patches, issues, checkTarget, error, partialMessage, running, settling, pending, accepted, canReview, canStart, start, cancel, clear, accept, reject, undo };
}
