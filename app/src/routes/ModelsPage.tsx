import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/apiBase';
import { fetchCustomModels, type CustomModelMeta } from '../lib/models';

// "我的模型"页(M17):自助维护 OpenAI 兼容格式的自定义模型接入配置。
// 接口地址会由后端归一化(剥掉尾部 /chat/completions,因为 Mastra 自动拼接);
// 当前版本仅支持 OpenAI 兼容格式,Anthropic 格式面板(/api)暂不支持——
// 页面文案如实说明这一点。
interface FormState {
  label: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
}

const EMPTY_FORM: FormState = { label: '', baseUrl: '', modelId: '', apiKey: '' };

export function ModelsPage() {
  const [entries, setEntries] = useState<CustomModelMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // editingId 为 null 表示新增;非 null 表示正在编辑该条目
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);
  // 表单容器引用:从列表中间点「编辑」时,把视口滚到表单,避免"凭空出现一个表单"
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/custom-models`);
      if (!res.ok) throw new Error(`加载失败: ${res.status}`);
      const data = (await res.json()) as { models?: CustomModelMeta[] };
      setEntries(data.models ?? []);
      // 联动刷新模型选择器的缓存(它只取 enabled 的条目)
      void fetchCustomModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const openEdit = (entry: CustomModelMeta) => {
    setEditingId(entry.id);
    setForm({ label: entry.label, baseUrl: entry.baseUrl, modelId: entry.modelId, apiKey: entry.apiKey });
    setFormOpen(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const submit = async () => {
    if (submitting) return;
    if (!form.label.trim() || !form.baseUrl.trim() || !form.modelId.trim() || !form.apiKey.trim()) {
      setError('四项内容都需要填写');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const url = editingId ? `${API_BASE}/custom-models/${editingId}` : `${API_BASE}/custom-models`;
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) {
        throw new Error(data.error ?? `保存失败(${res.status})`);
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleEnabled = async (entry: CustomModelMeta) => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/custom-models/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !entry.enabled }),
      });
      if (!res.ok) throw new Error(`操作失败(${res.status})`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (entry: CustomModelMeta) => {
    if (!window.confirm(`确定删除「${entry.label}」?该操作不可撤销。`)) return;
    setError('');
    try {
      const res = await fetch(`${API_BASE}/custom-models/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`删除失败(${res.status})`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const maskKey = (key: string): string => {
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
  };

  return (
    <div className="models-page">
      <div className="models-page-head">
        <div>
          <h1 className="models-page-title">我的模型</h1>
          <p className="models-page-desc">
            接入 OpenAI 兼容格式的模型网关:填写接口地址(系统会自动在地址后拼接 /chat/completions)、
            模型 ID 与 API Key,保存后在对话栏的模型选择器里选用。
            当前版本暂不支持 Anthropic 格式面板(如 /api);部分网关会在 OpenAI 面板上同时提供 Claude 系模型,可直接尝试。
          </p>
        </div>
        {!formOpen && (
          <button type="button" className="models-add-btn" onClick={openAdd}>
            + 添加模型
          </button>
        )}
      </div>

      {error && <div className="models-error">{error}</div>}

      {formOpen && (
        <div className="models-form" ref={formRef}>
          <div className="models-form-title">{editingId ? '编辑模型' : '添加模型'}</div>
          <label className="models-form-field">
            <span>显示名</span>
            <input
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder="如 公司网关·DeepSeek"
              autoFocus
            />
          </label>
          <label className="models-form-field">
            <span>接口地址(OpenAI 兼容,填到 /v1 为止)</span>
            <input
              value={form.baseUrl}
              onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
              placeholder="https://your-gateway.com/openai/v1"
              autoComplete="off"
            />
          </label>
          <label className="models-form-field">
            <span>模型 ID(可含斜杠)</span>
            <input
              value={form.modelId}
              onChange={e => setForm(f => ({ ...f, modelId: e.target.value }))}
              placeholder="如 deepseek-ai/DeepSeek-V4"
              autoComplete="off"
            />
          </label>
          <label className="models-form-field">
            <span>API Key</span>
            <input
              type="password"
              value={form.apiKey}
              onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
              placeholder="sk-..."
              autoComplete="off"
            />
          </label>
          <div className="models-form-actions">
            <button type="button" className="models-btn is-primary" disabled={submitting} onClick={() => void submit()}>
              {submitting ? '保存中…' : '保存'}
            </button>
            <button type="button" className="models-btn" onClick={closeForm} disabled={submitting}>
              取消
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="models-empty">加载中…</div>
      ) : entries.length === 0 ? (
        <div className="models-empty">
          <span>还没有自定义模型，接入你的 OpenAI 兼容网关后即可在对话栏选用</span>
          {!formOpen && (
            <button type="button" className="models-btn is-primary" onClick={openAdd}>
              + 添加模型
            </button>
          )}
        </div>
      ) : (
        <div className="models-list">
          {entries.map(entry => (
            <div key={entry.id} className={`models-entry${entry.enabled ? '' : ' is-disabled'}`}>
              <div className="models-entry-main">
                <div className="models-entry-row">
                  <span className="models-entry-label">{entry.label}</span>
                  <span className={`models-entry-state${entry.enabled ? ' is-on' : ''}`}>
                    {entry.enabled ? '已启用' : '已停用'}
                  </span>
                </div>
                <div className="models-entry-meta">模型 ID:{entry.modelId}</div>
                <div className="models-entry-meta">接口地址:{entry.baseUrl}</div>
                <div className="models-entry-meta">
                  Key:{revealedKeyId === entry.id ? entry.apiKey : maskKey(entry.apiKey)}
                  <button
                    type="button"
                    className="models-entry-reveal"
                    onClick={() => setRevealedKeyId(id => (id === entry.id ? null : entry.id))}
                  >
                    {revealedKeyId === entry.id ? '隐藏' : '显示'}
                  </button>
                </div>
              </div>
              <div className="models-entry-actions">
                <button
                  type="button"
                  className={`models-switch${entry.enabled ? ' is-on' : ''}`}
                  title={entry.enabled ? '点击停用' : '点击启用'}
                  onClick={() => void toggleEnabled(entry)}
                >
                  <span className="models-switch-knob" />
                </button>
                <button type="button" className="models-entry-btn" onClick={() => openEdit(entry)}>
                  编辑
                </button>
                <button type="button" className="models-entry-btn is-danger" onClick={() => void remove(entry)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
