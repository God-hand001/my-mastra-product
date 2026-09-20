// 对话可用模型(M7:对话栏模型切换;M17:自定义模型接入)
// 后端 agent.model 按请求动态解析(requestContext.model),见 agent.ts:
// 内置模型为路由字符串;自定义模型为 custom/<条目id>,由后端查配置返回
// OpenAICompatibleConfig 对象(自定义 baseUrl/apiKey/modelId)。
import { API_BASE } from './apiBase';

export interface ChatModel {
  id: string;
  label: string;
  desc: string;
}

export const CHAT_MODELS: ChatModel[] = [
  { id: 'deepseek/deepseek-v4-flash', label: '标准', desc: 'DeepSeek V4 Flash · 快速' },
  { id: 'deepseek/deepseek-v4-pro', label: '进阶', desc: 'DeepSeek V4 Pro · 更强推理' },
  { id: 'deepseek/deepseek-v4-flash-vision-exp', label: '视觉', desc: 'DeepSeek V4 Flash Vision · 支持图片(实验)' },
];

export const DEFAULT_MODEL = CHAT_MODELS[0].id;

const STORAGE_KEY = 'chat-model';

// ── 自定义模型(M17)────────────────────────────────────────────
export const CUSTOM_MODEL_PREFIX = 'custom/';

export function isCustomModelId(id: string): boolean {
  return id.startsWith(CUSTOM_MODEL_PREFIX);
}

// 后端 /custom-models 返回的原始条目(含 Key;仅"我的模型"页使用)
export interface CustomModelMeta {
  id: string;
  label: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  enabled: boolean;
}

// 选择器用的自定义模型缓存:模块级,所有 ModelSelect 实例共享一份,
// 通过 custom-models-changed 事件联动刷新,避免每个实例各自轮询。
let customCache: ChatModel[] | null = null;

// 拉取自定义模型并刷新缓存;成功后派发变更事件
export async function fetchCustomModels(): Promise<ChatModel[]> {
  try {
    const res = await fetch(`${API_BASE}/custom-models`);
    if (!res.ok) return customCache ?? [];
    const data = (await res.json()) as { models?: CustomModelMeta[] };
    customCache = (data.models ?? [])
      .filter(m => m.enabled)
      .map(m => ({
        id: `${CUSTOM_MODEL_PREFIX}${m.id}`,
        label: m.label,
        desc: `自定义 | ${m.modelId}`,
      }));
    window.dispatchEvent(new CustomEvent('custom-models-changed'));
    return customCache;
  } catch {
    // 后端未启动等:保持上一次缓存
    return customCache ?? [];
  }
}

export function getCachedCustomModels(): ChatModel[] {
  return customCache ?? [];
}

export function onCustomModelsChanged(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener('custom-models-changed', handler);
  return () => window.removeEventListener('custom-models-changed', handler);
}

// 全部可选模型 = 内置 + 已启用的自定义
export function allSelectableModels(): ChatModel[] {
  return [...CHAT_MODELS, ...getCachedCustomModels()];
}

// 选择器展示用的两段式文案:内置模型显示"层级 | 短名",自定义显示"显示名 | 模型ID"
export function modelDisplayParts(id: string): { label: string; detail: string } {
  const m = allSelectableModels().find(x => x.id === id);
  if (!m) return { label: id, detail: '' };
  if (isCustomModelId(id)) {
    return { label: m.label, detail: m.desc.replace(/^自定义 \| /, '') };
  }
  return { label: m.label, detail: id.split('/').pop() ?? id };
}

export function loadSelectedModel(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return DEFAULT_MODEL;
  // 自定义模型(custom/<id>)与内置模型均可;内置的须存在于清单,自定义的信任持久化
  if (isCustomModelId(saved)) return saved;
  return CHAT_MODELS.some(m => m.id === saved) ? saved : DEFAULT_MODEL;
}

export function saveSelectedModel(id: string): void {
  if (isCustomModelId(id) || CHAT_MODELS.some(m => m.id === id)) {
    localStorage.setItem(STORAGE_KEY, id);
  }
}

export function modelLabel(id: string): string {
  return CHAT_MODELS.find(m => m.id === id)?.label ?? id;
}
