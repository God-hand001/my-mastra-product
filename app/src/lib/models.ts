// 对话可用模型(M7:对话栏模型切换)
// 后端 agent.model 按请求动态解析(requestContext.model),见 agent.ts
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

export function loadSelectedModel(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  return CHAT_MODELS.some(m => m.id === saved) ? (saved as string) : DEFAULT_MODEL;
}

export function saveSelectedModel(id: string): void {
  if (CHAT_MODELS.some(m => m.id === id)) localStorage.setItem(STORAGE_KEY, id);
}

export function modelLabel(id: string): string {
  return CHAT_MODELS.find(m => m.id === id)?.label ?? id;
}
