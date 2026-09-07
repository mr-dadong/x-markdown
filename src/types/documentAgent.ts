/** 单文档任务只接收编辑器快照，不允许模型指定磁盘路径。 */
export interface DocumentAgentRequest {
  requestId: string;
  instruction: string;
  document: string;
  selection: string;
  model?: string;
}

/** 所有位置都基于任务开始时的原文，end 不包含在修改范围内。 */
export interface DocumentPatch {
  id: string;
  start: number;
  end: number;
  before: string;
  after: string;
  reason: string;
}

/** 阶段由实际工具事件驱动，不从思考或回复文字推断。 */
export type DocumentAgentStage = 'understand' | 'locate' | 'edit' | 'check' | 'review';
export interface DocumentAgentOperation {
  id: string;
  stage: DocumentAgentStage;
  title: string;
  detail: string;
  state: 'running' | 'done' | 'error';
  startedAt: number;
  endedAt?: number;
}
/** 目标完成情况是模型的明确报告，结构检查另由程序执行。 */
export interface DocumentAgentGoal {
  id: string;
  title: string;
  state: 'pending' | 'done' | 'unresolved';
  detail: string;
}

/** 新事件保留原有文本、修改与完成接口，普通对话不受影响。 */
export type DocumentAgentEvent = { requestId: string } & (
  | { type: 'progress'; message: string }
  | { type: 'stage'; stage: DocumentAgentStage; state: 'running' | 'done'; message: string }
  | { type: 'operation'; operation: DocumentAgentOperation }
  | { type: 'goals'; goals: DocumentAgentGoal[] }
  | { type: 'budget'; step: number; maxSteps: number; taskMs: number; message: string }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'patch'; patch: DocumentPatch }
  | { type: 'done'; issues: string[]; outcome?: 'complete' | 'incomplete' }
  | { type: 'error'; message: string }
);

/** 独立接口保留原有对话协议。 */
export interface DocumentAgentApi {
  invoke: (request: DocumentAgentRequest) => Promise<void>;
  cancel: (requestId: string) => void;
  onEvent: (callback: (event: DocumentAgentEvent) => void) => () => void;
}
