import { useCallback, useEffect, useState } from 'react';
import {
  authorizeConnector,
  getSkillDetail,
  importExtension,
  listExtensions,
  toggleExtension,
  type ConnectorMeta,
  type ExtensionsView,
  type SkillMeta,
} from '../lib/extensionsClient';
import { selectDirectory } from '../lib/projectsClient';
import { isDesktop } from '../lib/desktop';
import { MarkdownText } from '../components/MarkdownText';
import '../styles/extensions.css';

// M10 扩展面板:技能 / 连接器两标签卡片流,支持开关、详情抽屉、本地导入

type Tab = 'skill' | 'connector';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'skill', label: '技能' },
  { key: 'connector', label: '连接器' },
];

// 分类 Tab 顺序(未列出的分类追加在后面;与千问办公的分类体系对齐)
const CATEGORY_ORDER = [
  '内容创作',
  '视觉创意',
  '数据分析',
  '咨询研究',
  '产品开发',
  '效率工具',
  '市场销售',
  '电商零售',
];

function categoryOrder(cat: string | undefined): number {
  if (!cat) return CATEGORY_ORDER.length;
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/** 展示名:中文名优先,否则原名 */
function displayName(item: SkillMeta | ConnectorMeta): string {
  return (item.nameZh ?? '').trim() || item.name;
}

/** 展示描述:中文描述优先,否则原 description */
function displayDesc(item: SkillMeta | ConnectorMeta): string {
  return (item.descZh ?? '').trim() || item.description || '(暂无描述)';
}

/** 展示图标:无内置图标时按类型给默认值 */
function displayIcon(item: SkillMeta | ConnectorMeta): string {
  return (item.icon ?? '').trim() || ('dir' in item ? '🧩' : '🔌');
}

/** 连接器详情:command/args 全量展示,env 只展示键名(值脱敏) */
function ConnectorDetail({ connector }: { connector: ConnectorMeta }) {
  const cfg = connector.config as {
    command?: unknown;
    args?: unknown;
    env?: Record<string, unknown>;
    type?: unknown;
  };
  const args = Array.isArray(cfg.args) ? (cfg.args as unknown[]) : [];
  const envKeys = cfg.env && typeof cfg.env === 'object' ? Object.keys(cfg.env) : [];
  return (
    <table className="ext-config-table">
      <tbody>
        <tr>
          <th>类型</th>
          <td>{typeof cfg.type === 'string' ? cfg.type : 'stdio'}</td>
        </tr>
        <tr>
          <th>命令</th>
          <td>
            <span className="ext-config-code">{String(cfg.command ?? '—')}</span>
          </td>
        </tr>
        <tr>
          <th>参数</th>
          <td>
            {args.length === 0
              ? '—'
              : args.map((a, i) => (
                  <span className="ext-config-code" key={i} style={{ marginRight: 6 }}>
                    {String(a)}
                  </span>
                ))}
          </td>
        </tr>
        <tr>
          <th>环境变量</th>
          <td>
            {envKeys.length === 0
              ? '—'
              : envKeys.map(k => (
                  <span key={k} style={{ marginRight: 8 }}>
                    <span className="ext-config-code">{k}</span>=
                    <span className="ext-config-masked">••••••</span>
                  </span>
                ))}
          </td>
        </tr>
        {connector.lastError && (
          <tr>
            <th>最近错误</th>
            <td style={{ color: '#e0554d' }}>{connector.lastError}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function ExtensionsPage() {
  const [tab, setTab] = useState<Tab>('skill');
  const [data, setData] = useState<ExtensionsView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 详情抽屉:技能名(拉取 SKILL.md 原文)或连接器对象
  const [skillDetail, setSkillDetail] = useState<{ name: string; content: string } | null>(null);
  const [connectorDetail, setConnectorDetail] = useState<ConnectorMeta | null>(null);

  const refresh = useCallback(() => {
    listExtensions()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (item: SkillMeta | ConnectorMeta, kind: Tab) => {
    setError('');
    if (kind === 'connector') {
      setConnectorDetail(item as ConnectorMeta);
      return;
    }
    const skill = item as SkillMeta;
    try {
      const detail = await getSkillDetail(skill.name);
      setSkillDetail({ name: skill.name, content: detail.content });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importLocal = async (kind: Tab) => {
    setError('');
    const dir = await selectDirectory();
    if (!dir) return;
    await act(() => importExtension(dir, kind));
  };

  const skills = data?.skills ?? [];
  const connectors = data?.connectors ?? [];
  const items: Array<SkillMeta | ConnectorMeta> = tab === 'skill' ? skills : connectors;

  // 分类 Tab:「全部」+ 数据中实际出现的分类(按固定顺序)
  const categories = [...new Set(items.map(i => i.category).filter((c): c is string => !!c))].sort(
    (a, b) => categoryOrder(a) - categoryOrder(b),
  );
  const [activeCategory, setActiveCategory] = useState<string>('全部');
  const currentCategory = categories.includes(activeCategory) || activeCategory === '全部' ? activeCategory : '全部';
  const filtered = currentCategory === '全部' ? items : items.filter(i => i.category === currentCategory);
  const countOf = (cat: string) => (cat === '全部' ? items.length : items.filter(i => i.category === cat).length);

  return (
    <div className="ext-page">
      <div className="ext-header">
        <div>
          <h2 className="ext-title">扩展</h2>
          <div className="ext-subtitle">技能为助手注入领域知识与流程规范,连接器(MCP)为其接入外部工具</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isDesktop() && TABS.map(t => (
            <button
              key={t.key}
              className="sched-btn"
              disabled={busy}
              onClick={() => void importLocal(t.key)}
            >
              导入本地{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ext-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`ext-tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => {
              setTab(t.key);
              setActiveCategory('全部');
            }}
          >
            {t.label}
            <span style={{ marginLeft: 6, opacity: 0.65 }}>
              {t.key === 'skill' ? skills.length : connectors.length}
            </span>
          </button>
        ))}
      </div>

      {/* 分类 Tab */}
      {data !== null && items.length > 0 && (
        <div className="ext-cat-tabs">
          {['全部', ...categories].map(cat => (
            <button
              key={cat}
              className={`ext-cat-tab${currentCategory === cat ? ' is-active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
              <span className="ext-cat-count">{countOf(cat)}</span>
            </button>
          ))}
        </div>
      )}

      {error && <div className="ext-error">{error}</div>}

      {data === null ? (
        <div className="ext-empty">
          <div className="ext-empty-icon">🧩</div>
          加载中…
        </div>
      ) : filtered.length === 0 ? (
        <div className="ext-empty">
          <div className="ext-empty-icon">🧩</div>
          {currentCategory === '全部' ? `暂无${tab === 'skill' ? '技能' : '连接器'}` : `「${currentCategory}」分类下暂无内容`}
          {isDesktop() && currentCategory === '全部' && (
            <div className="ext-empty-sub">可点右上角「导入本地{tab === 'skill' ? '技能' : '连接器'}」</div>
          )}
        </div>
      ) : (
        <div className="ext-grid">
          {filtered.map(item => {
            const isSkill = 'dir' in item;
            const connector = item as ConnectorMeta;
            const connectorState = !connector.invalid && connector.enabled
              ? connector.lastError
                ? 'error'
                : 'ok'
              : 'idle';
            const zhName = displayName(item);
            const showId = zhName !== item.name;
            return (
              <div
                key={`${item.name}-${isSkill ? (item as SkillMeta).dir : connector.name}`}
                className={`ext-tile${item.enabled ? '' : ' is-disabled'}`}
                onClick={() => void openDetail(item, tab)}
              >
                <div className="ext-tile-top">
                  <span className="ext-tile-icon">{displayIcon(item)}</span>
                  <div className="ext-tile-titles">
                    <div className="ext-tile-name-row">
                      <span className="ext-tile-name">{zhName}</span>
                      <span className={`ext-badge${'source' in item && item.source === 'local' ? ' is-local' : ''}`}>
                        {'source' in item && item.source === 'local' ? '本地导入' : '内置'}
                      </span>
                    </div>
                    {showId && <div className="ext-tile-id">{item.name}</div>}
                  </div>
                  <button
                    className={`ext-switch${item.enabled ? ' is-on' : ''}`}
                    title={item.enabled ? '点击禁用' : '点击启用'}
                    disabled={busy || (tab === 'connector' && connector.invalid)}
                    onClick={async e => {
                      // 阻断冒泡:点开关不触发卡片详情
                      e.stopPropagation();
                      // 连接器从禁用切到启用时,先检查并申请未授予能力
                      if (tab === 'connector' && !item.enabled) {
                        const caps = connector.config.capabilities as { network?: boolean; externalWrite?: string[] } | undefined;
                        const granted = new Set(connector.grantedCapabilities ?? []);
                        const missing: string[] = [];
                        if (caps?.network === true && !granted.has('network')) {
                          missing.push('联网');
                        }
                        if (Array.isArray(caps?.externalWrite) && caps.externalWrite.length > 0 && !granted.has('externalWrite')) {
                          missing.push('写外部目录');
                        }
                        if (missing.length > 0) {
                          const ok = window.confirm(`启用 ${connector.name} 需要授权以下能力：${missing.join('、')}。是否允许？(批准后长期记住)`);
                          if (!ok) return;
                          await act(() => authorizeConnector(connector.name).then(() => toggleExtension(tab, connector.name)));
                          return;
                        }
                      }
                      void act(() => toggleExtension(tab, item.name));
                    }}
                  >
                    <span className="ext-switch-knob" />
                  </button>
                </div>
                <div className="ext-tile-desc">{displayDesc(item)}</div>
                <div className="ext-tile-bottom">
                  <span className="ext-tile-cat">{item.category ?? '未分类'}</span>
                  {tab === 'connector' && (
                    <>
                      <span className={`ext-dot${connectorState === 'ok' ? ' is-ok' : connectorState === 'error' ? ' is-error' : ''}`} />
                      {connector.invalid && <span className="ext-badge" style={{ color: '#e0554d', borderColor: '#f3c1bd' }}>配置无效</span>}
                      {connector.lastError && (
                        <span className="ext-tile-error" title={connector.lastError}>⚠ {connector.lastError.slice(0, 40)}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 技能详情抽屉 */}
      {skillDetail && (
        <>
          <div className="ext-drawer-mask" onClick={() => setSkillDetail(null)} />
          <div className="ext-drawer">
            <div className="ext-drawer-header">
              <span className="ext-drawer-title">技能 · {skillDetail.name}</span>
              <button className="ext-drawer-close" onClick={() => setSkillDetail(null)}>✕</button>
            </div>
            <div className="ext-drawer-body">
              <MarkdownText text={skillDetail.content} />
            </div>
          </div>
        </>
      )}

      {/* 连接器详情抽屉 */}
      {connectorDetail && (
        <>
          <div className="ext-drawer-mask" onClick={() => setConnectorDetail(null)} />
          <div className="ext-drawer">
            <div className="ext-drawer-header">
              <span className="ext-drawer-title">连接器 · {connectorDetail.name}</span>
              <button className="ext-drawer-close" onClick={() => setConnectorDetail(null)}>✕</button>
            </div>
            <div className="ext-drawer-body">
              <ConnectorDetail connector={connectorDetail} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
