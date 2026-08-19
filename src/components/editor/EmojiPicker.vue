<template>
  <!-- 双形态共用一个组件：grid 是斜杠命令打开的完整选择器，list 是冒号触发的紧凑建议列表。 -->
  <div data-emoji-picker class="fixed z-50 rounded-xl border border-line/60 bg-paper shadow-[0_8px_30px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
    :style="position" contenteditable="false" @mousedown.stop>
    <template v-if="mode === 'grid'">
      <!-- 顶部：标题 + 搜索框 -->
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line/40 px-3">
        <span class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-ink/10 text-[11px] font-bold text-ink">
          <Icon icon="lucide:smile-plus" :size="13" />
        </span>
        <input ref="searchInput" v-model="searchDraft" type="text" placeholder="搜索表情…"
          class="h-7 min-w-0 flex-1 rounded-md bg-transparent text-[12px] text-ink outline-none placeholder:text-muted/50"
          @keydown="handleSearchKeydown" @blur="handleSearchBlur">
        <span class="shrink-0 font-mono text-[10px] text-muted/60">ESC</span>
      </div>

      <!-- 分类条：仅在未搜索时展示 -->
      <div v-if="!searchDraft.trim()" class="editor-scroll flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line/40 px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button v-for="category in emojiCategories" :key="category" type="button"
          class="h-6 shrink-0 rounded-md px-2 text-[11px] transition-colors"
          :class="activeCategory === category ? 'bg-control-active font-medium text-ink' : 'text-muted hover:bg-control-hover hover:text-secondary'"
          @mousedown.prevent="selectCategory(category)">
          {{ category }}
        </button>
      </div>

      <!-- 表情网格 -->
      <div class="editor-scroll grid max-h-[216px] min-h-0 grid-cols-8 gap-0.5 overflow-y-auto px-2 py-2">
        <button v-for="(item, index) in visibleItems" :key="item.shortcode" type="button"
          class="flex h-8 w-8 items-center justify-center rounded-md text-[18px] leading-none transition-colors"
          :data-emoji-selected="index === activeIndex || undefined"
          :class="index === activeIndex ? 'bg-control-active' : 'hover:bg-control-hover'"
          :title="`:${item.shortcode}:`"
          @mouseenter="gridSelectedIndex = index" @mousedown.prevent="emitSelect(item)">
          {{ item.emoji }}
        </button>
        <div v-if="visibleItems.length === 0" class="col-span-8 flex flex-col items-center gap-1 py-8 text-muted">
          <Icon icon="lucide:search-x" :size="18" class="text-muted/50" />
          <span class="text-[11px]">没有匹配的表情</span>
        </div>
      </div>

      <!-- 底部：当前选中项预览 + 插入 -->
      <div class="flex h-10 shrink-0 items-center gap-2 border-t border-line/40 px-3">
        <span class="flex h-6 w-6 items-center justify-center rounded bg-control/60 text-[16px] leading-none">
          {{ selectedItem?.emoji ?? '' }}
        </span>
        <span class="min-w-0 flex-1 truncate text-[12px] text-secondary">
          {{ selectedItem ? `${selectedItem.name}  :${selectedItem.shortcode}:` : '' }}
        </span>
        <button type="button"
          class="flex h-7 shrink-0 items-center rounded-md bg-ink px-3 text-[11px] font-medium text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30"
          :disabled="!selectedItem" @mousedown.prevent="selectedItem && emitSelect(selectedItem)">
          插入
        </button>
      </div>
    </template>

    <template v-else>
      <!-- 紧凑建议列表：跟随光标，键盘操作由编辑器统一处理 -->
      <div class="flex max-h-[264px] min-h-0 flex-col py-1.5">
        <div class="editor-scroll flex min-h-0 flex-col overflow-y-auto">
          <button v-for="(item, index) in items" :key="item.shortcode" type="button"
            class="mx-1 flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-75"
            :data-emoji-selected="index === activeIndex || undefined"
            :class="index === activeIndex ? 'bg-control-active text-ink' : 'text-secondary hover:bg-control-hover hover:text-ink'"
            @mouseenter="emit('selectIndex', index)" @mousedown.prevent="emitSelect(item)">
            <span class="w-6 shrink-0 text-center text-[16px] leading-none">{{ item.emoji }}</span>
            <span class="min-w-0 flex-1 truncate text-[12px]">{{ item.name }}</span>
            <span class="shrink-0 font-mono text-[10px] text-muted/60">:{{ item.shortcode }}:</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Icon } from "@iconify/vue/offline";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { emojiCategories, type EmojiItem } from "../../modules/emojis";

const props = defineProps<{
  mode: "grid" | "list";
  query: string;
  selectedIndex: number;
  items: EmojiItem[];
  position: Record<string, string>;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  select: [item: EmojiItem];
  selectIndex: [index: number];
  cancel: [];
}>();

const GRID_COLUMNS = 8;

const searchInput = ref<HTMLInputElement | null>(null);
const searchDraft = ref(props.query);
const activeCategory = ref<string | null>(null);
const gridSelectedIndex = ref(0);

// 列表模式的选中项由编辑器键盘导航驱动（父组件 prop），网格模式由组件内部维护。
const activeIndex = computed(() =>
  props.mode === "list" ? props.selectedIndex : gridSelectedIndex.value,
);

// 输入与父组件查询保持同步，父组件负责真正过滤。
watch(searchDraft, (value) => emit("update:query", value));

// 搜索词或分类变化时回到列表头部。
watch([() => props.query, activeCategory], () => {
  gridSelectedIndex.value = 0;
});

const visibleItems = computed<EmojiItem[]>(() => {
  if (props.mode !== "grid") return props.items;
  if (searchDraft.value.trim()) return props.items;
  return activeCategory.value
    ? props.items.filter((item) => item.category === activeCategory.value)
    : props.items;
});

const selectedItem = computed<EmojiItem | null>(
  () => visibleItems.value[activeIndex.value] ?? null,
);

const selectCategory = (category: string): void => {
  activeCategory.value = activeCategory.value === category ? null : category;
};

const scrollSelectedIntoView = (): void => {
  void nextTick(() => {
    document
      .querySelector("[data-emoji-picker] [data-emoji-selected]")
      ?.scrollIntoView({ block: "nearest" });
  });
};

// 列表模式下父组件方向键导航会更新 selectedIndex，这里跟随滚动到可见区域。
watch(
  () => props.selectedIndex,
  () => {
    if (props.mode === "list") scrollSelectedIntoView();
  },
);

const navigate = (key: string): void => {
  const count = visibleItems.value.length;
  if (count === 0) return;
  const current = gridSelectedIndex.value;
  let next = current;
  if (key === "ArrowRight") next = (current + 1) % count;
  else if (key === "ArrowLeft") next = (current - 1 + count) % count;
  else if (key === "ArrowDown") next = Math.min(current + GRID_COLUMNS, count - 1);
  else if (key === "ArrowUp") next = Math.max(current - GRID_COLUMNS, 0);
  if (next !== current) {
    gridSelectedIndex.value = next;
    scrollSelectedIntoView();
  }
};

const emitSelect = (item: EmojiItem): void => {
  emit("select", item);
};

const handleSearchKeydown = (event: KeyboardEvent): void => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    navigate(event.key);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (selectedItem.value) emitSelect(selectedItem.value);
  } else if (event.key === "Escape") {
    event.preventDefault();
    emit("cancel");
  }
};

// 焦点移出选择器时关闭；焦点仍在面板内部（如点击面板其他区域）则保持打开。
const handleSearchBlur = (event: FocusEvent): void => {
  const related = event.relatedTarget as Node | null;
  if (related instanceof HTMLElement && related.closest("[data-emoji-picker]")) return;
  emit("cancel");
};

onMounted(() => {
  if (props.mode === "grid") searchInput.value?.focus();
});
</script>
