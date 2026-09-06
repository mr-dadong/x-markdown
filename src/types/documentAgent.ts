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

/** 操作记录与文本回复分开传递，避免把模型文字当成执行成功。 */
export type DocumentAgentEvent = { requestId: string } & (
  | { type: 'progress'; message: string }
  | { type: 'text'; text: string }
  // 模型返回的思考增量单独传递，不混入文档正文或最终回复。
  | { type: 'reasoning'; text: string }
  | { type: 'patch'; patch: DocumentPatch }
  | { type: 'done'; issues: string[] }
  | { type: 'error'; message: string }
);

/** 独立接口保留原有对话协议。 */
export interface DocumentAgentApi {
  invoke: (request: DocumentAgentRequest) => Promise<void>;
  cancel: (requestId: string) => void;
  onEvent: (callback: (event: DocumentAgentEvent) => void) => () => void;
}
