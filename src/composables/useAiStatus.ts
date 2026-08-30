import { onBeforeUnmount, onMounted, ref } from "vue";
import { aiService } from "../services/aiService";
import type { AiStatus } from "../types/ai";

/**
 * 轻量级 AI 状态查询：用于判断 AI 是否已配置完成，
 * 在选区工具栏、AI 面板等入口处决定展示何种 UI。
 *
 * 全局单例（模块级 ref + 共享订阅计数），保证多个组件
 * 共享同一份状态：在主进程保存设置后，所有入口都会同步刷新，
 * 不会出现同一个动作入口一会儿显示「配置 AI 后使用」、
 * 一会儿又正常显示动作按钮的状态不一致问题。
 */
const status = ref<AiStatus | null>(null);
const loading = ref(true);
let subscribers = 0;
let refreshPromise: Promise<void> | null = null;

const refresh = async (): Promise<void> => {
  if (refreshPromise) {
    await refreshPromise;
    return;
  }
  loading.value = true;
  refreshPromise = (async () => {
    try {
      status.value = await aiService.getStatus();
    } catch {
      status.value = null;
    } finally {
      loading.value = false;
      refreshPromise = null;
    }
  })();
  await refreshPromise;
};

const isConfigured = (): boolean => Boolean(status.value?.configured);

export const useAiStatus = () => {
  onMounted(() => {
    subscribers += 1;
    // 首次挂载（subscribers === 1）触发一次查询；
    // 后续组件挂载直接复用已有的状态，避免重复 IPC。
    if (subscribers === 1) void refresh();
  });

  onBeforeUnmount(() => {
    subscribers = Math.max(0, subscribers - 1);
  });

  return {
    status,
    loading,
    isConfigured,
    /** 手动触发刷新，AI 设置保存后可调用以同步新状态。 */
    refresh,
  };
};
