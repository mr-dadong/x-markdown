const serializeError = (value: unknown): Record<string, string> => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? "",
    };
  }
  return { message: String(value) };
};

/**
 * 诊断事件等级：错误只记录异常，info 用于关键交互路径（启动、打开面板等）。
 * 主进程对 level !== "error" 的事件会拒绝写入磁盘，避免 info 事件
 * 占满日志配额，导致真正的错误被覆盖或找不到。
 */
export interface RendererDiagnosticEvent {
  level: "error" | "info" | "warn";
  event: string;
  detail?: Record<string, unknown> | string;
}

export const diagnosticService = {
  error: (event: string, error: unknown): void => {
    window.electronAPI.logRendererDiagnostic({
      level: "error",
      event,
      detail: serializeError(error),
    });
  },
  /**
   * 用于排查「为什么点了没反应」一类问题：事件名、位置、条件判断都写清楚，
   * 方便在本地或生产包的诊断日志里按关键词反查。调用时避免携带
   * 文档正文、AI 内容、API 密钥等敏感信息。
   */
  info: (event: string, detail?: Record<string, string | number | boolean | null>): void => {
    window.electronAPI.logRendererDiagnostic({
      level: "info",
      event,
      detail,
    });
  },
  installGlobalErrorHandlers: (): void => {
    window.addEventListener("error", (event) => {
      diagnosticService.error("renderer.window-error", event.error ?? event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
      diagnosticService.error("renderer.unhandled-rejection", event.reason);
    });
  },
};
