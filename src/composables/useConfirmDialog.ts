import { readonly, ref } from 'vue'

export interface ConfirmDialogOptions {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

interface ConfirmDialogState extends ConfirmDialogOptions {
  cancelLabel: string
  tone: 'default' | 'danger'
}

const dialogState = ref<ConfirmDialogState | null>(null)
let resolveConfirmation: ((confirmed: boolean) => void) | null = null

const requestConfirmation = (options: ConfirmDialogOptions): Promise<boolean> => {
  // 同一时刻只处理一个需要用户决策的操作，避免多个弹窗相互覆盖。
  if (dialogState.value) return Promise.resolve(false)

  dialogState.value = {
    ...options,
    cancelLabel: options.cancelLabel ?? '取消',
    tone: options.tone ?? 'default',
  }

  return new Promise<boolean>((resolve) => {
    resolveConfirmation = resolve
  })
}

const finishConfirmation = (confirmed: boolean): void => {
  if (!dialogState.value || !resolveConfirmation) return

  const resolve = resolveConfirmation
  dialogState.value = null
  resolveConfirmation = null
  resolve(confirmed)
}

export const useConfirmDialog = () => ({
  dialogState: readonly(dialogState),
  requestConfirmation,
  confirm: () => finishConfirmation(true),
  cancel: () => finishConfirmation(false),
})
