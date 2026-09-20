import { registerApiRoute } from '@mastra/core/server';
import {
  addCustomModel,
  listCustomModels,
  removeCustomModel,
  updateCustomModel,
  type CustomModelEntry,
} from '../services/custom-models';

// 自定义模型管理路由(M17):"我的模型"页的增删改查。
// 每个 handler 都捕获异常 —— 错误必须带具体原因返回,不能被框架吞成一句
// Internal Server Error(2026-09-20 定时任务 500 排查教训)。
function asNonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const customModelRoutes = [
  registerApiRoute('/custom-models', {
    method: 'GET',
    handler: async c => {
      try {
        return c.json({ models: listCustomModels() });
      } catch (err) {
        return c.json({ error: `读取自定义模型失败: ${errMessage(err)}` }, 500);
      }
    },
  }),

  registerApiRoute('/custom-models', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await c.req.json<Record<string, unknown>>();
        const label = asNonEmptyString(body.label);
        const baseUrl = asNonEmptyString(body.baseUrl);
        const modelId = asNonEmptyString(body.modelId);
        const apiKey = asNonEmptyString(body.apiKey);
        if (!label || !baseUrl || !modelId || !apiKey) {
          return c.json({ error: 'label、baseUrl、modelId、apiKey 均为必填' }, 400);
        }
        const model: CustomModelEntry = addCustomModel({ label, baseUrl, modelId, apiKey });
        return c.json({ ok: true, model });
      } catch (err) {
        return c.json({ error: `添加自定义模型失败: ${errMessage(err)}` }, 500);
      }
    },
  }),

  registerApiRoute('/custom-models/:id', {
    method: 'PUT',
    handler: async c => {
      try {
        const body = await c.req.json<Record<string, unknown>>();
        const patch: Partial<Omit<CustomModelEntry, 'id' | 'createdAt'>> = {};
        const label = asNonEmptyString(body.label);
        const baseUrl = asNonEmptyString(body.baseUrl);
        const modelId = asNonEmptyString(body.modelId);
        const apiKey = asNonEmptyString(body.apiKey);
        if (label) patch.label = label;
        if (baseUrl) patch.baseUrl = baseUrl;
        if (modelId) patch.modelId = modelId;
        if (apiKey) patch.apiKey = apiKey;
        if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
        const model = updateCustomModel(c.req.param('id'), patch);
        if (!model) return c.json({ error: '未找到该自定义模型' }, 404);
        return c.json({ ok: true, model });
      } catch (err) {
        return c.json({ error: `更新自定义模型失败: ${errMessage(err)}` }, 500);
      }
    },
  }),

  registerApiRoute('/custom-models/:id', {
    method: 'DELETE',
    handler: async c => {
      try {
        // 幂等删除:条目不存在也返回成功
        removeCustomModel(c.req.param('id'));
        return c.json({ ok: true });
      } catch (err) {
        return c.json({ error: `删除自定义模型失败: ${errMessage(err)}` }, 500);
      }
    },
  }),
];
