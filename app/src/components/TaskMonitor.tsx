import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_BASE } from '../lib/apiBase';
import { getContextUsage, type ContextUsage } from '../lib/contextClient';
import { parseArtifacts, type Artifact } from '../lib/artifacts';

// TaskMonitor 需要的是 /api/memory/threads/:id/messages 返回的原始消息，
// 不是经 toUIMessages 转换后的 UIMessage(转换会把 signal 消息过滤掉)。
// 这里就地定义一个够用的最小类型，不与 messages.ts 的 MastraMessage 复用。
export interface RawMastraMessage {
  id?: string;
  role: string;
  type?: string;
  content?:
    | string
    | {
        format?: number;
        parts?: Array<{
          type?: string;
          text?: string;
          toolInvocation?: {
            toolName?: string;
            args?: unknown;
            [key: string]: unknown;
          };
        }>;
        metadata?: {
          signal?: {
            metadata?: {
              value?: {
                tasks?: TodoItem[];
              };
            };
          };
        };
      };
  createdAt?: string;
}

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export interface TaskMonitorProps {
  rawMessages: RawMastraMessage[];
  threadId: string;
  workspaceSince: number;
}

interface MonitorSectionProps {
  title: string;
  empty: string;
  isEmpty: boolean;
  children?: ReactNode;
}

// details/summary 天然支持键盘 Tab 聚焦 + Enter/Space 折叠展开(N6)
function MonitorSection({ title, empty, isEmpty, children }: MonitorSectionProps) {
  return (
    <details className="monitor-section" open>
      <summary className="monitor-section-title">{title}</summary>
      <div className="monitor-section-body">{isEmpty ? <div className="monitor-empty">{empty}</div> : children}</div>
    </details>
  );
}

// 拼接 assistant 消息里的纯文本 parts,用于解析产物标记/历史摘要前缀
function getMessageText(m: RawMastraMessage): string {
  if (typeof m.content === 'string') return m.content;
  return (m.content?.parts ?? [])
    .filter(p => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text as string)
    .join('\n');
}

// signal 消息的 value.tasks 每次都是全量任务数组(非增量),取最新一条即可(见 m14-t0-notes)
function useLatestTodos(rawMessages: RawMastraMessage[]): TodoItem[] {
  return useMemo(() => {
    for (let i = rawMessages.length - 1; i >= 0; i--) {
      const m = rawMessages[i];
      if (m.role !== 'signal') continue;
      const tasks = (m.content as any)?.metadata?.signal?.metadata?.value?.tasks;
      if (Array.isArray(tasks)) return tasks as TodoItem[];
    }
    return [];
  }, [rawMessages]);
}

function TodoSection({ rawMessages }: { rawMessages: RawMastraMessage[] }) {
  const todos = useLatestTodos(rawMessages);
  return (
    <MonitorSection title="待办" empty="暂无待办" isEmpty={todos.length === 0}>
      {todos.map(task => (
        <div key={task.id} className="monitor-todo-item">
          <span
            className={`monitor-todo-icon${
              task.status === 'completed' ? ' monitor-todo-completed-icon' : ''
            }`}
            aria-hidden="true"
          >
            {task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '▸' : '○'}
          </span>
          <span className={task.status === 'completed' ? 'monitor-todo-completed' : ''}>{task.content}</span>
        </div>
      ))}
    </MonitorSection>
  );
}

function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

// 简化版类型图标:按扩展名给色块+字母(ArtifactCard.tsx 的 FileIcon 未导出,不复用)
function FileIcon({ ext, kind }: { ext: string; kind?: 'final' | 'work' }) {
  const map: Record<string, { bg: string; label: string }> = {
    pdf: { bg: '#e53e3e', label: 'PDF' },
    docx: { bg: '#2b579a', label: 'W' },
    doc: { bg: '#2b579a', label: 'W' },
    xlsx: { bg: '#217346', label: 'X' },
    xls: { bg: '#217346', label: 'X' },
    csv: { bg: '#217346', label: 'X' },
    pptx: { bg: '#d24726', label: 'P' },
    ppt: { bg: '#d24726', label: 'P' },
    png: { bg: '#805ad5', label: '图' },
    jpg: { bg: '#805ad5', label: '图' },
    jpeg: { bg: '#805ad5', label: '图' },
    webp: { bg: '#805ad5', label: '图' },
    gif: { bg: '#805ad5', label: '图' },
    svg: { bg: '#805ad5', label: '图' },
    html: { bg: '#e34c26', label: '</>' },
    htm: { bg: '#e34c26', label: '</>' },
    txt: { bg: '#6b7280', label: 'T' },
    md: { bg: '#6b7280', label: 'T' },
    json: { bg: '#6b7280', label: 'T' },
    py: { bg: '#6b7280', label: 'T' },
    js: { bg: '#6b7280', label: 'T' },
    ts: { bg: '#6b7280', label: 'T' },
    sh: { bg: '#6b7280', label: 'T' },
  };
  const item = map[ext];
  const label = item?.label ?? '文';
  return (
    <span
      className={`monitor-file-icon monitor-file-icon-${kind ?? 'final'}`}
      style={{ backgroundColor: item?.bg ?? '#6b7280' }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

interface WorkspaceFileEntry {
  path: string;
  name: string;
  type: 'dir' | 'file';
  mtimeMs?: number;
}

function ArtifactRow({
  name,
  path,
  kind,
}: {
  name: string;
  path: string;
  kind: 'final' | 'work';
}) {
  const ext = getExt(name);
  const [revealHint, setRevealHint] = useState<string | null>(null);

  useEffect(() => {
    if (!revealHint) return;
    const t = setTimeout(() => setRevealHint(null), 2000);
    return () => clearTimeout(t);
  }, [revealHint]);

  const openArtifact = () => {
    window.dispatchEvent(new CustomEvent('h0-open-artifact', { detail: { name, path } }));
  };

  const reveal = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/workspace/files/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRevealHint('定位失败');
    }
  };

  return (
    <div className="monitor-artifact-row" onClick={openArtifact} role="button" tabIndex={0} aria-label={name}>
      <FileIcon ext={ext} kind={kind} />
      <span className="monitor-artifact-name">{name}</span>
      <button
        className="monitor-artifact-reveal-btn"
        onClick={reveal}
        title="定位文件夹"
        aria-label="定位文件夹"
        type="button"
      >
        ⌖
      </button>
      {revealHint && <span className="monitor-artifact-reveal-hint">{revealHint}</span>}
    </div>
  );
}

function ArtifactSection({
  rawMessages,
  workspaceSince,
}: {
  rawMessages: RawMastraMessage[];
  threadId: string;
  workspaceSince: number;
}) {
  const finalArtifacts = useMemo(() => {
    const map = new Map<string, Artifact>();
    for (const m of rawMessages) {
      if (m.role !== 'assistant') continue;
      const text = getMessageText(m);
      for (const a of parseArtifacts(text)) {
        map.set(a.path, a);
      }
    }
    return [...map.values()];
  }, [rawMessages]);

  const [workFiles, setWorkFiles] = useState<Array<{ path: string; name: string; mtimeMs: number }>>([]);

  useEffect(() => {
    let alive = true;
    // 【产物:】标记里的 path 无前导斜杠,而目录列表返回的 path 带斜杠('/a.pptx'),
    // 直接比较永远不相等,最终文件会重复出现在工作文件区 —— 两侧都归一化后再比对
    const finalPaths = new Set(finalArtifacts.map(a => a.path.replace(/^\/+/, '')));

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/workspace/files`);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { entries?: WorkspaceFileEntry[] };
        const list = (data.entries ?? [])
          .filter(
            e =>
              e.type === 'file' &&
              typeof e.mtimeMs === 'number' &&
              e.mtimeMs > workspaceSince &&
              !finalPaths.has(e.path.replace(/^\/+/, '')),
          )
          .sort((a, b) => (b.mtimeMs as number) - (a.mtimeMs as number))
          .slice(0, 20)
          .map(e => ({ path: e.path, name: e.name, mtimeMs: e.mtimeMs as number }));
        if (alive) setWorkFiles(list);
      } catch {
        // 拉取失败保持上一次的展示,不清空(避免闪烁)
      }
    };

    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [workspaceSince, finalArtifacts]);

  const isEmpty = finalArtifacts.length === 0 && workFiles.length === 0;

  return (
    <MonitorSection title="产物" empty="暂无产物" isEmpty={isEmpty}>
      <div className="monitor-subsection">
        <div className="monitor-subtitle">最终文件</div>
        {finalArtifacts.length === 0 ? (
          <div className="monitor-empty">暂无最终文件</div>
        ) : (
          finalArtifacts.map(a => <ArtifactRow key={a.path} name={a.name} path={a.path} kind="final" />)
        )}
      </div>
      <div className="monitor-subsection">
        <div className="monitor-subtitle">工作文件</div>
        {workFiles.length === 0 ? (
          <div className="monitor-empty">暂无工作文件</div>
        ) : (
          workFiles.map(f => <ArtifactRow key={f.path} name={f.name} path={f.path} kind="work" />)
        )}
      </div>
    </MonitorSection>
  );
}

interface ConnectorInfo {
  name: string;
  nameZh?: string;
}

function SkillsMcpSection({ rawMessages }: { rawMessages: RawMastraMessage[] }) {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/extensions`)
      .then(async res => {
        if (!res.ok) return;
        const data = (await res.json()) as { connectors?: Array<{ name: string; nameZh?: string; enabled: boolean }> };
        const enabled = (data.connectors ?? []).filter(c => c.enabled).map(c => ({ name: c.name, nameZh: c.nameZh }));
        setConnectors(enabled);
      })
      .catch(() => {
        // 连接器列表拉取失败时 MCP 区退化为空,不影响技能区判定
      });
  }, []);

  const { skills, mcps } = useMemo(() => {
    const skillSet = new Set<string>();
    const seenMcpLabels = new Set<string>();
    const mcpList: string[] = [];

    for (const m of rawMessages) {
      if (m.role !== 'assistant') continue;
      const parts = typeof m.content === 'object' ? m.content?.parts ?? [] : [];
      for (const p of parts) {
        if (p.type !== 'tool-invocation' || !p.toolInvocation) continue;
        const toolName = p.toolInvocation.toolName ?? '';
        if (toolName === 'skill') {
          const args = p.toolInvocation.args as Record<string, unknown> | undefined;
          const name = typeof args?.name === 'string' ? args.name : '';
          if (name) skillSet.add(name);
        } else {
          const connector = connectors.find(c => toolName.startsWith(`${c.name}_`));
          if (connector) {
            const rest = toolName.slice(connector.name.length + 1);
            const label = `${connector.nameZh ?? connector.name} · ${rest}`;
            if (!seenMcpLabels.has(label)) {
              seenMcpLabels.add(label);
              mcpList.push(label);
            }
          }
        }
      }
    }

    return { skills: [...skillSet], mcps: mcpList };
  }, [rawMessages, connectors]);

  const isEmpty = skills.length === 0 && mcps.length === 0;

  return (
    <MonitorSection title="技能与 MCP" empty="本次任务未使用技能与 MCP 工具" isEmpty={isEmpty}>
      <div className="monitor-subsection">
        <div className="monitor-subtitle">技能</div>
        {skills.length === 0 ? (
          <div className="monitor-empty">本次任务未使用技能</div>
        ) : (
          skills.map(name => (
            <div key={name} className="monitor-tag">
              {name}
            </div>
          ))
        )}
      </div>
      <div className="monitor-subsection">
        <div className="monitor-subtitle">MCP</div>
        {mcps.length === 0 ? (
          <div className="monitor-empty">本次任务未使用 MCP 工具</div>
        ) : (
          mcps.map(label => (
            <div key={label} className="monitor-tag">
              {label}
            </div>
          ))
        )}
      </div>
    </MonitorSection>
  );
}

function MemorySection({ threadId, rawMessages }: { threadId: string; rawMessages: RawMastraMessage[] }) {
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const u = await getContextUsage(threadId);
        if (alive) {
          setUsage(u);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);

  const summaryCount = useMemo(() => {
    return rawMessages.filter(m => {
      if (m.role !== 'assistant') return false;
      const text = getMessageText(m);
      return text.startsWith('【历史摘要】');
    }).length;
  }, [rawMessages]);

  return (
    <MonitorSection title="意识更新" empty="" isEmpty={false}>
      <div className="monitor-subsection">
        <div className="monitor-subtitle">短期记忆</div>
        {error ? (
          <div className="monitor-empty">暂无法获取上下文用量</div>
        ) : usage ? (
          <>
            <div className="monitor-progress-track">
              <div className="monitor-progress-fill" style={{ width: `${usage.percentage}%` }} />
            </div>
            <div className="monitor-progress-text">{usage.percentage}%</div>
            {summaryCount > 0 && (
              <span className="monitor-compressed-badge">已压缩 {summaryCount} 次</span>
            )}
          </>
        ) : (
          <div className="monitor-empty">加载中...</div>
        )}
      </div>
      <div className="monitor-subsection">
        <div className="monitor-subtitle">长期记忆</div>
        <div className="monitor-memory-state">{summaryCount > 0 ? '有历史摘要' : '暂无历史摘要'}</div>
      </div>
    </MonitorSection>
  );
}

export function TaskMonitor({ rawMessages, threadId, workspaceSince }: TaskMonitorProps) {
  return (
    <div className="monitor-root">
      <TodoSection rawMessages={rawMessages} />
      <ArtifactSection rawMessages={rawMessages} threadId={threadId} workspaceSince={workspaceSince} />
      <SkillsMcpSection rawMessages={rawMessages} />
      <MemorySection threadId={threadId} rawMessages={rawMessages} />
    </div>
  );
}
