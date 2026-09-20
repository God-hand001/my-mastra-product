import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectRoot } from './project-root';

// 自定义模型条目(M17):用户在"我的模型"页自助维护的 OpenAI 兼容模型接入配置。
// 持久化到 storage/custom-models.json —— 与 extensions-registry.json 同目录同风格;
// Key 明文存储:本产品是本机单用户应用,该文件与 .env 同属一个信任域。
const STORE_PATH = path.join(resolveProjectRoot(), 'storage', 'custom-models.json');

export interface CustomModelEntry {
  id: string; // uuid;选择器里的引用格式为 `custom/${id}`
  label: string; // 显示名(如"公司网关·DeepSeek")
  baseUrl: string; // OpenAI 兼容接口地址(不含 /chat/completions 后缀,保存时已归一化)
  modelId: string; // 发给网关的模型 ID,可含斜杠(如 deepseek-ai/DeepSeek-V4)
  apiKey: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// 保存时归一化:去尾部斜杠、剥掉结尾的 /chat/completions —— 用户可能直接粘贴
// 完整路径(如 https://xxx/openai/v1/chat/completions),而 Mastra 会自动在
// baseUrl 后拼接 /chat/completions,不剥就会拼出双重路径导致 404。
function normalizeBaseUrl(url: string): string {
  let out = url.trim();
  while (out.endsWith('/')) out = out.slice(0, -1);
  if (out.toLowerCase().endsWith('/chat/completions')) {
    out = out.slice(0, -'/chat/completions'.length);
    while (out.endsWith('/')) out = out.slice(0, -1);
  }
  return out;
}

function loadStore(): CustomModelEntry[] {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw) as { models?: CustomModelEntry[] };
    return Array.isArray(data.models) ? data.models : [];
  } catch {
    // 文件不存在或损坏:按空列表处理,不抛出(首次使用时文件本来就不存在)
    return [];
  }
}

function saveStore(models: CustomModelEntry[]): void {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify({ models }, null, 2), 'utf8');
}

export function listCustomModels(): CustomModelEntry[] {
  return loadStore();
}

export function getCustomModel(id: string): CustomModelEntry | undefined {
  return loadStore().find(m => m.id === id);
}

export function enabledCustomModels(): CustomModelEntry[] {
  return loadStore().filter(m => m.enabled);
}

export function addCustomModel(input: {
  label: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
}): CustomModelEntry {
  const models = loadStore();
  const now = new Date().toISOString();
  const entry: CustomModelEntry = {
    id: crypto.randomUUID(),
    label: input.label.trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    modelId: input.modelId.trim(),
    apiKey: input.apiKey.trim(),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  models.push(entry);
  saveStore(models);
  return entry;
}

export function updateCustomModel(
  id: string,
  patch: Partial<Omit<CustomModelEntry, 'id' | 'createdAt'>>,
): CustomModelEntry | undefined {
  const models = loadStore();
  const idx = models.findIndex(m => m.id === id);
  if (idx < 0) return undefined;
  const next: CustomModelEntry = { ...models[idx], ...patch, updatedAt: new Date().toISOString() };
  next.label = String(next.label).trim();
  next.modelId = String(next.modelId).trim();
  next.apiKey = String(next.apiKey).trim();
  next.baseUrl = normalizeBaseUrl(String(next.baseUrl));
  models[idx] = next;
  saveStore(models);
  return next;
}

export function removeCustomModel(id: string): boolean {
  const models = loadStore();
  const next = models.filter(m => m.id !== id);
  if (next.length === models.length) return false;
  saveStore(next);
  return true;
}
