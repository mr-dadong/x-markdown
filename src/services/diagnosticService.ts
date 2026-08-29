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

export const diagnosticService = {
  error: (event: string, error: unknown): void => {
    window.electronAPI.logRendererDiagnostic({
      level: "error",
      event,
      detail: serializeError(error),
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
