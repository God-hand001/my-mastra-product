import { useCallback, useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE } from '../lib/apiBase';
import { MarkdownText } from './MarkdownText';
import { listFiles, formatSize, type DriveFileMeta } from '../lib/driveClient';
import { isDesktop } from '../lib/desktop';
import { openPath } from '../lib/projectsClient';
import { renderAsync } from 'docx-preview';
import { renderPptxWithSanitize, type PptxPreviewer } from '../lib/pptxPreview';
import { XlsxView } from './XlsxView';
import '../styles/preview-pptx.css';
import { TaskMonitor, type RawMastraMessage } from './TaskMonitor';
import { BrowserPreview } from './BrowserPreview';
import { resolveUrlInput } from '../lib/urlInput';
import { SlidesWorkspace } from './SlidesWorkspace';
import { DocViewer } from './DocViewer';
import { DesignWorkspace } from './DesignWorkspace';
import { AskUserPanel, type AskUserQuestion } from './AskUserPanel';
import { isDecidedLocally } from './SandboxApprovalCard';
import { DesignPlanCard, type DesignPlanData } from './DesignPlanCard';

// 预览标签的负载:摘要无额外数据;文件按来源区分 path/fileId;EDA 供后续批次扩展。
export type PreviewPayload =
  | { kind: 'summary' }
  | { kind: 'file'; source: 'workspace' | 'drive'; path?: string; fileId?: string; name?: string; ext?: string }
  | { kind: 'eda' }
  | { kind: 'newtab' }
  | { kind: 'browser'; url: string; title?: string }
  | { kind: 'artifact-tag'; artifactType: 'html' | 'slides' | 'doc'; title: string; content: string }
  | { kind: 'askuser' }
  | { kind: 'design-plan' };

export type PreviewTab = {
  id: string;
  kind: 'summary' | 'file' | 'eda' | 'newtab' | 'browser' | 'artifact-tag' | 'askuser' | 'design-plan';
  title: string;
  payload: PreviewPayload;
  zoom?: number;
};

export type PreviewPanelProps = {
  threadId: string;
  rawMessages?: RawMastraMessage[];
  workspaceSince?: number;
  runtime?: import('@assistant-ui/react').AssistantRuntime;
  tabs: PreviewTab[];
  activeTabId: string;
  onTabsChange: (tabs: PreviewTab[]) => void;
  onActivate: (id: string) => void;
  onClose: () => void;
};

type WorkspaceEntry = {
  path: string;
  name: string;
  type: 'dir' | 'file';
};

export type FilePayload = Extract<PreviewPayload, { kind: 'file' }>;

// 最近预览签的最小化记录;点击新标签页里的列表即可还原。
export type RecentTabEntry = {
  kind: 'summary' | 'file';
  name: string;
  source?: 'workspace' | 'drive';
  path?: string;
  fileId?: string;
  ext?: string;
};

const TEXT_EXTENSIONS = new Set([
  'txt',
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'html',
  'xml',
  'csv',
  'py',
  'sh',
  'yml',
  'yaml',
]);

// mammoth / SheetJS 输出的是裸 HTML(没有任何样式),直接塞进 iframe 会是浏览器默认样式。
// 这里注入一套接近 Word 观感的排版:正文字号/行距、标题层级、表格边框。
const DOC_PREVIEW_STYLE = `
  body { font-family: 'Microsoft YaHei', system-ui, sans-serif; font-size: 15px; line-height: 1.8; color: #1f2329; padding: 48px 56px; margin: 0; }
  h1 { font-size: 24px; } h2 { font-size: 20px; } h3 { font-size: 17px; }
  h1, h2, h3 { margin: 24px 0 12px; font-weight: 600; }
  p { margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  td, th { border: 1px solid #dcdfe6; padding: 8px 12px; font-size: 14px; }
  th { background: #f5f7fa; }
  ul, ol { padding-left: 24px; margin: 0 0 12px; }
  img { max-width: 100%; }
`;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const EDA_EXTENSIONS = new Set(['epro', 'eprj']);

function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

// 预览签文件类型小图标,颜色按扩展名区分;browser 标签用地球图标。
function TabIcon({ ext, kind }: { ext?: string; kind?: PreviewTab['kind'] }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  let color = '#9ca3af';
  let icon = <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h6" /></>;

  if (kind === 'browser') {
    color = '#3b82f6';
    icon = <><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>;
  } else if (ext === 'docx') {
    color = '#0ea5e9';
    icon = <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h6" /><path d="M9 17h4" /></>;
  } else if (ext === 'pptx') {
    color = '#d946ef';
    icon = <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M8 12h8" /><path d="M9 16h6" /><path d="M9 20h6" /></>;
  } else if (ext === 'xls' || ext === 'xlsx') {
    color = '#14b8a6';
    icon = <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h2v5H9z" /><path d="M13 13h2v5h-2z" /></>;
  } else if (ext === 'html') {
    color = '#f97316';
    icon = <><path d="m7 16-4-4 4-4" /><path d="m17 8 4 4-4 4" /><path d="M9 21h6" /></>;
  } else if (ext === 'md' || ext === 'txt') {
    color = '#6b7280';
    icon = <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h6" /><path d="M9 17h6" /></>;
  } else if (ext === 'pdf') {
    color = '#ef4444';
    icon = <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h6" /><path d="M9 17l2-4 2 4" /></>;
  } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext ?? '')) {
    color = '#a855f7';
    icon = <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>;
  }

  return <span style={{ color, display: 'inline-flex', flexShrink: 0 }}><svg {...common}>{icon}</svg></span>;
}


function isEdaPayload(name: string, path: string, ext: string): boolean {
  // 只认真正的 EDA 工程文件扩展名。此前还按文件名/路径里含 "eda" 子串匹配,
  // 导致"EDA软件介绍.docx"这类只是内容提到 EDA、本身是普通文档的文件被误判,
  // 落进这个占位视图而不是走 docx-preview 正常渲染。
  return EDA_EXTENSIONS.has(ext);
}

function samePayload(left: PreviewPayload, right: PreviewPayload): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'file' && right.kind === 'file') {
    return left.source === right.source && (left.path ?? left.fileId) === (right.path ?? right.fileId);
  }
  if (left.kind === 'browser' && right.kind === 'browser') {
    return left.url === right.url;
  }
  return left.kind === right.kind;
}

// 每次打开 file/summary 签时刷新最近列表,最多保留 10 条。
export function rememberRecentTab(tab: PreviewTab): void {
  if (tab.kind !== 'file' && tab.kind !== 'summary') return;
  let entry: RecentTabEntry;
  if (tab.kind === 'summary') {
    entry = { kind: 'summary', name: tab.title };
  } else if (tab.payload.kind === 'file') {
    entry = {
      kind: 'file',
      name: tab.payload.name ?? tab.title,
      source: tab.payload.source,
      path: tab.payload.path,
      fileId: tab.payload.fileId,
      ext: tab.payload.ext,
    };
  } else {
    return;
  }
  const previous = readRecentTabs().filter(item => {
    if (item.kind !== entry.kind) return true;
    return entry.kind === 'summary'
      ? item.name !== entry.name
      : item.path !== entry.path || item.fileId !== entry.fileId;
  });
  localStorage.setItem('h0-recent-tabs', JSON.stringify([entry, ...previous].slice(0, 10)));
  window.dispatchEvent(new CustomEvent('h0-recent-tabs-changed'));
}

export function readRecentTabs(): RecentTabEntry[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem('h0-recent-tabs') ?? '[]');
    return Array.isArray(data) ? (data as RecentTabEntry[]) : [];
  } catch {
    return [];
  }
}

// 任务监控标签:加载中显示 spinner,失败可重试,内部模块支持折叠。
function SummaryPreview({ threadId }: { threadId: string }) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/threads/${encodeURIComponent(threadId)}/summary`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `加载失败: ${res.status}`);
      setSummary(data.summary ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  return (
    <div className="preview-section">
      <button className="preview-section-head" onClick={() => setExpanded(value => !value)}>
        <span>任务监控</span>
        <span className={`preview-collapse-arrow${expanded ? ' is-expanded' : ''}`}>▾</span>
      </button>
      {expanded && (
        <div className="preview-section-body">
          {loading && <div className="preview-spinner" aria-label="摘要加载中" />}
          {!loading && error && (
            <div className="preview-state">
              <p>{error}</p>
              <button className="preview-retry" onClick={() => void loadSummary()}>
                重试
              </button>
            </div>
          )}
          {!loading && !error && !summary && <div className="preview-state">暂无内容</div>}
          {!loading && !error && summary && <div className="summary-text">{summary}</div>}
        </div>
      )}
    </div>
  );
}

// 文件预览:workspace 按扩展名路由,drive 按既有类型分流展示。
// 用 docx-preview 渲染原始 docx，保留 Word 的字体、字号、页面尺寸与页眉页脚
function DocxView({ payload }: { payload: FilePayload }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // 计算并应用"适应页宽"缩放：将整页等比缩小到容器可用宽度，仅在页面更宽时缩放。
  const fitToWidth = useCallback(() => {
    const container = bodyRef.current;
    if (!container) return;
    const wrapper = container.querySelector('.docxview-wrapper') as HTMLElement | null;
    if (!wrapper) return;

    // 容器可用宽度要扣除自身水平 padding，否则算出的 scale 仍会导致溢出。
    const containerStyle = window.getComputedStyle(container);
    const paddingX = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight);
    const availableWidth = container.clientWidth - paddingX;

    // docx-preview 的真实页面宽度在 wrapper 内部的 <section> 上；
    // wrapper 自身是 block 级会撑满容器，量它永远得到容器宽，缩放会失效。
    const section = wrapper.querySelector('section') as HTMLElement | null;
    if (!section) return;
    const pageWidth = section.offsetWidth;

    const scale = availableWidth > 0 && pageWidth > 0 ? Math.min(1, availableWidth / pageWidth) : 1;

    if (scale < 1) {
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.transformOrigin = 'top center';
      // transform 不改变元素占位高度，必须将父容器高度同步设为缩放后的实际高度，
      // 否则下方会留下与原始高度等高的空白区域。
      container.style.height = `${wrapper.offsetHeight * scale}px`;
    } else {
      // 容器足够宽时移除缩放与高度修正，避免残留影响后续渲染。
      wrapper.style.transform = '';
      wrapper.style.transformOrigin = '';
      container.style.height = '';
    }
  }, []);

  useEffect(() => {
    // 切换文件时先清空容器，避免前后文档叠加
    if (bodyRef.current) {
      bodyRef.current.innerHTML = '';
      bodyRef.current.style.height = '';
    }
    if (styleRef.current) styleRef.current.innerHTML = '';
    setLoading(true);
    setError('');

    const controller = new AbortController();

    const load = async () => {
      try {
        const url =
          payload.source === 'workspace'
            ? `${API_BASE}/workspace/files/raw?path=${encodeURIComponent(payload.path ?? '')}`
            : `${API_BASE}/drive/files/${payload.fileId ?? ''}/download`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`加载失败: ${res.status}`);
        const blob = await res.blob();
        if (!bodyRef.current || !styleRef.current) return;
        // 再次清空，确保 renderAsync 之前无残留
        bodyRef.current.innerHTML = '';
        bodyRef.current.style.height = '';
        styleRef.current.innerHTML = '';
        await renderAsync(blob, bodyRef.current, styleRef.current, {
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true,
          className: 'docxview',
        });
        // 渲染完成后立即执行一次适应页宽，避免初始加载时横向溢出。
        fitToWidth();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setLoading(false);
      }
    };

    void load();

    return () => {
      controller.abort();
      if (bodyRef.current) {
        bodyRef.current.innerHTML = '';
        bodyRef.current.style.height = '';
      }
      if (styleRef.current) styleRef.current.innerHTML = '';
    };
  }, [payload, retryKey, fitToWidth]);

  // 监听容器宽度变化，窗口拖动、最大化或面板百分比调整时重算缩放。
  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;
    // 先清理旧观察器，避免重复订阅。
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    const observer = new ResizeObserver(() => fitToWidth());
    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [fitToWidth]);

  // 关键:两个容器必须【始终】渲染,不能在 loading/error 时用 return 换成 spinner。
  // 否则 loading=true 那一刻容器不在 DOM 里,useEffect 里的 bodyRef.current 为 null,
  // renderAsync 被那句防御性 return 静默跳过,之后 loading 转 false 也不会再触发 —— 表现就是永久空白。
  // 因此 spinner 与错误态改用绝对定位的覆盖层。
  return (
    <div className="docx-view">
      {/* docx-preview 生成的 CSS 选择器都带 className 前缀(.docxview ...),作用域由此隔离;
          把 <style> 放进组件内的容器,是为了切换文件或卸载时能一并清掉,不在 document.head 里累积。 */}
      <div ref={styleRef} className="docx-style-container" aria-hidden="true" />
      <div ref={bodyRef} className="docx-body" />
      {loading && (
        <div className="docx-overlay">
          <div className="preview-spinner" aria-label="Word 文档加载中" />
        </div>
      )}
      {!loading && error && (
        <div className="docx-overlay">
          <div className="preview-state">
            <p>{error}</p>
            <button type="button" className="preview-retry" onClick={() => setRetryKey(k => k + 1)}>
              重试
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// 用 pptx-preview 渲染原始 pptx,按 slide 分页显示(M8-T5)
function PptxView({ payload }: { payload: FilePayload }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<PptxPreviewer | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const fitToWidth = useCallback(() => {
    const container = bodyRef.current;
    if (!container) return;
    const slide = container.querySelector('.pptx-preview-slide-wrapper') as HTMLElement | null;
    if (!slide) return;

    const containerStyle = window.getComputedStyle(container);
    const paddingX = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight);
    const availableWidth = container.clientWidth - paddingX;
    const slideWidth = slide.offsetWidth;
    const scale = availableWidth > 0 && slideWidth > 0 ? Math.min(1, availableWidth / slideWidth) : 1;

    const wrapper = container.querySelector('.pptx-preview-wrapper') as HTMLElement | null;
    if (!wrapper) return;
    if (scale < 1) {
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.transformOrigin = 'top center';
      container.style.height = `${wrapper.offsetHeight * scale}px`;
    } else {
      wrapper.style.transform = '';
      wrapper.style.transformOrigin = '';
      container.style.height = '';
    }
  }, []);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = '';
    setLoading(true);
    setError('');
    previewerRef.current = null;
    const controller = new AbortController();

    const load = async () => {
      try {
        const url =
          payload.source === 'workspace'
            ? `${API_BASE}/workspace/files/raw?path=${encodeURIComponent(payload.path ?? '')}`
            : `${API_BASE}/drive/files/${payload.fileId ?? ''}/download`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`加载失败: ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        if (!bodyRef.current) return;
        // pptx 渲染含"幽灵 slideMaster 声明"自愈逻辑,公共实现在 lib/pptxPreview.ts
        await renderPptxWithSanitize(bodyRef.current, arrayBuffer, p => {
          previewerRef.current = p;
        });
        fitToWidth();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setLoading(false);
      }
    };

    void load();

    return () => {
      controller.abort();
      try {
        previewerRef.current?.destroy();
      } catch {
        // ignore
      }
      if (bodyRef.current) bodyRef.current.innerHTML = '';
    };
  }, [payload, retryKey, fitToWidth]);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    const observer = new ResizeObserver(() => fitToWidth());
    observer.observe(container);
    resizeObserverRef.current = observer;
    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [fitToWidth]);

  return (
    <div className="pptx-view">
      <div ref={bodyRef} className="pptx-body" />
      {loading && (
        <div className="pptx-overlay">
          <div className="preview-spinner" aria-label="PPT 加载中" />
        </div>
      )}
      {!loading && error && (
        <div className="pptx-overlay">
          <div className="preview-state">
            <p>{error}</p>
            <button type="button" className="preview-retry" onClick={() => setRetryKey(k => k + 1)}>
              重试
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilePreview({
  payload,
  controls,
  zoom = 100,
}: {
  payload: FilePayload;
  controls?: ReactNode;
  zoom?: number;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [previewMode, setPreviewMode] = useState<'preview' | 'code'>('preview');
  const [reloadKey, setReloadKey] = useState(0);

  const ext = payload.ext || fileExtension(payload.name || payload.path || payload.fileId || '');
  const isSpreadsheetPreview = ext === 'xlsx' || ext === 'xls';

  useEffect(() => {
    setPreviewMode('preview');
    if (payload.source !== 'workspace') {
      setLoading(false);
      return;
    }
    if (ext === 'docx' || ext === 'pptx') {
      // docx/pptx/xlsx 直接由对应视图渲染原始字节，FilePreview 只负责结束加载态
      setLoading(false);
      return;
    }
    if (isSpreadsheetPreview) {
      // xlsx/xls 由 XlsxView(SheetJS)自行拉取解析,这里只负责结束加载态
      setLoading(false);
      return;
    }
    const shouldLoadText = ext === 'md' || TEXT_EXTENSIONS.has(ext);
    if (!shouldLoadText) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/workspace/files/content?path=${encodeURIComponent(payload.path ?? '')}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        if (!res.ok || data.error || data.content === undefined) {
          throw new Error(data.error ?? `读取失败: ${res.status}`);
        }
        setFileName(data.path?.split('/').pop() ?? '');
        setContent(data.content);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [payload, ext, isSpreadsheetPreview, reloadKey]);

  const driveFileId = payload.fileId ?? '';
  const driveDownloadUrl = payload.source === 'drive' ? `${API_BASE}/drive/files/${driveFileId}/download` : '';

  if (payload.source === 'workspace') {
    if (loading) return <div className="preview-spinner" aria-label="文件加载中" />;
    if (error) {
      return (
        <div className="preview-state">
          <p>{error}</p>
          {isSpreadsheetPreview && (
            <button type="button" className="preview-retry" onClick={() => setReloadKey(key => key + 1)}>
              重试
            </button>
          )}
        </div>
      );
    }
    if (isEdaPayload(payload.name ?? '', payload.path ?? '', ext)) {
      return (
        <div className="preview-eda-card">
          <div className="preview-note">EDA 渲染器接入中</div>
          <div className="preview-eda-name">{payload.name ?? payload.path?.split('/').pop()}</div>
          <div className="preview-eda-path">{payload.path}</div>
        </div>
      );
    }
    if (ext === 'html') {
      // zoom 状态存的是百分比(如 100 表示 100%),而 CSS zoom 需要比例值:
      // 直接传 100 会被浏览器当成放大 100 倍,必须除以 100
      return (
        <div className="preview-html" style={{ zoom: zoom / 100 }}>
          <div className="preview-mode-toggle" role="group" aria-label="预览模式">
            <button
              type="button"
              className={previewMode === 'preview' ? 'is-active' : ''}
              onClick={() => setPreviewMode('preview')}
            >
              预览
            </button>
            <button
              type="button"
              className={previewMode === 'code' ? 'is-active' : ''}
              onClick={() => setPreviewMode('code')}
            >
              代码
            </button>
            {controls}
          </div>
          {previewMode === 'preview' ? (
            <iframe
              className="preview-iframe"
              srcDoc={content}
              sandbox="allow-scripts allow-modals allow-pointer-lock allow-forms"
              title={payload.name ?? 'HTML 预览'}
            />
          ) : (
            <pre className="preview-code">{content}</pre>
          )}
        </div>
      );
    }
    if (ext === 'md') return <div className="preview-markdown"><MarkdownText text={content} /></div>;
    if (ext === 'docx') {
      return <DocxView payload={payload} />;
    }
    if (ext === 'pptx') {
      return <PptxView payload={payload} />;
    }
    if (isSpreadsheetPreview) {
      return <XlsxView payload={payload} />;
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
      return (
        <img
          className="preview-image"
          src={`${API_BASE}/workspace/files/raw?path=${encodeURIComponent(payload.path ?? '')}`}
          alt={payload.name ?? '工作区图片'}
        />
      );
    }
    if (ext === 'pdf') {
      return (
        <iframe
          className="preview-frame"
          src={`${API_BASE}/workspace/files/raw?path=${encodeURIComponent(payload.path ?? '')}`}
          title={payload.name ?? 'PDF 预览'}
        />
      );
    }
    if (!TEXT_EXTENSIONS.has(ext)) {
      return (
        <div className="preview-state">
          <p>暂不支持预览该文件类型</p>
          <a
            className="preview-download-button"
            href={`${API_BASE}/workspace/files/raw?path=${encodeURIComponent(payload.path ?? '')}`}
            download={payload.name ?? payload.path?.split('/').pop()}
          >
            下载文件
          </a>
        </div>
      );
    }
    return <pre className="preview-code">{content}</pre>;
  }

  if (IMAGE_EXTENSIONS.has(ext)) return <img className="preview-image" src={driveDownloadUrl} alt={fileName} />;
  if (ext === 'pdf') return <iframe className="preview-frame" src={driveDownloadUrl} title={fileName} />;
  if (ext === 'docx') {
    return <DocxView payload={payload} />;
  }
  if (ext === 'pptx') {
    return <PptxView payload={payload} />;
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return <XlsxView payload={payload} />;
  }
  return (
    <div className="preview-state">
      <p>暂不支持预览该文件类型</p>
      <a href={driveDownloadUrl} target="_blank" rel="noreferrer">
        下载文件
      </a>
    </div>
  );
}

// 新标签页:聚合常用入口、最近文件,并允许打开网盘/新建工作区文件。
function NewTabPreview({
  onOpenTab,
}: {
  onOpenTab?: (kind: PreviewTab['kind'], title: string, payload: PreviewPayload) => void;
}) {
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileMeta[] | null>(null);
  const [driveError, setDriveError] = useState('');
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileError, setNewFileError] = useState('');
  const [recentTabs, setRecentTabs] = useState<RecentTabEntry[]>([]);
  const [recentQuery, setRecentQuery] = useState('');
  const [urlHint, setUrlHint] = useState('');

  const refreshRecentTabs = useCallback(() => setRecentTabs(readRecentTabs()), []);

  useEffect(() => {
    refreshRecentTabs();
    window.addEventListener('h0-recent-tabs-changed', refreshRecentTabs);
    return () => window.removeEventListener('h0-recent-tabs-changed', refreshRecentTabs);
  }, [refreshRecentTabs]);

  useEffect(() => {
    if (!drivePickerOpen || driveFiles !== null) return;
    listFiles()
      .then(setDriveFiles)
      .catch(err => setDriveError(err instanceof Error ? err.message : String(err)));
  }, [driveFiles, drivePickerOpen]);

  const createFile = async () => {
    const name = newFileName.trim();
    if (!name) return;
    setNewFileError('');
    try {
      const res = await fetch(`${API_BASE}/workspace/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `/新建/${name}`, content: '' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `创建失败: ${res.status}`);
      onOpenTab?.('file', name, {
        kind: 'file',
        source: 'workspace',
        path: data.path,
        name,
        ext: fileExtension(name),
      });
      setCreatingFile(false);
      setNewFileName('');
    } catch (err) {
      setNewFileError(err instanceof Error ? err.message : String(err));
    }
  };

  const openRecent = (entry: RecentTabEntry) => {
    if (entry.kind === 'summary') {
      onOpenTab?.('summary', entry.name, { kind: 'summary' });
      return;
    }
    if (!entry.source) return;
    onOpenTab?.('file', entry.name, {
      kind: 'file',
      source: entry.source,
      path: entry.path,
      fileId: entry.fileId,
      name: entry.name,
      ext: entry.ext ?? fileExtension(entry.name),
    });
  };

  const query = recentQuery.trim().toLowerCase();
  const filteredRecent = query
    ? recentTabs.filter(entry => entry.name.toLowerCase().includes(query))
    : recentTabs;

  return (
    <div className="preview-newtab">
      <div className="preview-newtab-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={recentQuery}
          placeholder="搜索或输入网址"
          onChange={event => {
            setRecentQuery(event.target.value);
            if (urlHint) setUrlHint('');
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter') return;
            const result = resolveUrlInput(recentQuery);
            if (result.kind === 'rejected') {
              setUrlHint(result.reason);
              return;
            }
            setUrlHint('');
            onOpenTab?.('browser', recentQuery, { kind: 'browser', url: result.url });
          }}
        />
      </div>
      {urlHint && <div className="browser-hint">{urlHint}</div>}

      <div className="preview-newtab-actions">
        {isDesktop() && (
          <button
            className="preview-newtab-action"
            onClick={() => void openPath('workspace')}
            title="打开工作空间目录"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>打开项目文件夹</span>
          </button>
        )}
        <button
          className="preview-newtab-action"
          onClick={() => {
            setDrivePickerOpen(true);
            setDriveError('');
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
          </svg>
          <span>打开云盘文件</span>
        </button>
        <button className="preview-newtab-action" onClick={() => setCreatingFile(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>新建文件</span>
        </button>
        <button className="preview-newtab-action" disabled title="后续上线">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 17l6-6-6-6M12 19h8" />
          </svg>
          <span>打开终端</span>
        </button>
      </div>

      {creatingFile && (
        <div className="preview-newfile-row">
          <input
            autoFocus
            value={newFileName}
            placeholder="文件名,如 报告.md"
            onChange={event => setNewFileName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void createFile();
            }}
          />
          <button onClick={() => void createFile()}>创建</button>
          <button onClick={() => setCreatingFile(false)}>取消</button>
        </div>
      )}
      {newFileError && <div className="preview-state">{newFileError}</div>}

      <div className="preview-file-head">最近文件</div>
      <div className="preview-recent-list">
        {recentTabs.length === 0 && <div className="preview-state">暂无最近文件</div>}
        {recentQuery.trim() && filteredRecent.length === 0 && (
          <div className="preview-state">没有匹配的文件</div>
        )}
        {filteredRecent.map((entry, index) => {
          const ext = entry.kind === 'file' ? entry.ext ?? fileExtension(entry.name) : undefined;
          return (
            <button
              key={`${entry.kind}-${entry.path ?? entry.fileId ?? entry.name}-${index}`}
              className="preview-file-item"
              onClick={() => openRecent(entry)}
            >
              <TabIcon ext={ext} />
              <span>{entry.name}</span>
            </button>
          );
        })}
      </div>

      {drivePickerOpen && (
        <div className="picker-mask" onClick={() => setDrivePickerOpen(false)}>
          <div className="picker-panel" onClick={event => event.stopPropagation()}>
            <div className="picker-tabs">
              <button className="is-active">云盘文件</button>
              <button className="picker-close" onClick={() => setDrivePickerOpen(false)}>×</button>
            </div>
            <div className="picker-drive-list">
              {driveFiles === null && !driveError && <div className="picker-tip">加载中…</div>}
              {driveError && <div className="picker-tip">{driveError}</div>}
              {driveFiles?.length === 0 && <div className="picker-tip">网盘还是空的</div>}
              {driveFiles?.map(file => (
                <div
                  key={file.id}
                  className="picker-drive-item"
                  onClick={() => {
                    onOpenTab?.('file', file.name, {
                      kind: 'file',
                      source: 'drive',
                      fileId: file.id,
                      name: file.name,
                      ext: fileExtension(file.name),
                    });
                    setDrivePickerOpen(false);
                  }}
                >
                  <span className="picker-drive-name">{file.name}</span>
                  <span className="picker-drive-meta">{formatSize(file.size)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type PreviewContentProps = {
  tab: PreviewTab;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  threadId?: string;
  rawMessages?: RawMastraMessage[];
  runtime?: import('@assistant-ui/react').AssistantRuntime;
  workspaceSince?: number;
  onOpenTab?: (kind: PreviewTab['kind'], title: string, payload: PreviewPayload) => void;
  active?: boolean;
  onTitleChange?: (title: string) => void;
  askUserItems?: Array<{ runId: string; toolCallId: string; questions: AskUserQuestion[] }>;
  setAskUserItems?: React.Dispatch<
    React.SetStateAction<Array<{ runId: string; toolCallId: string; questions: AskUserQuestion[] }>>
  >;
  designPlanItems?: Array<{ runId: string; toolCallId: string; plan: DesignPlanData['plan'] }>;
  setDesignPlanItems?: React.Dispatch<
    React.SetStateAction<Array<{ runId: string; toolCallId: string; plan: DesignPlanData['plan'] }>>
  >;
  // M15 bug 修复:回答提交后关闭「问题」标签本身,而不是留一个显示
  // "暂无等待回答的问题"的空标签(2026-09-20 用户反馈)。
  onCloseTab?: (id: string) => void;
};

// 单签内容渲染:主面板与独立弹窗复用,缩放/全屏/弹出控件也保持一致。
export function PreviewContent({ tab, zoom, onZoomChange, threadId, rawMessages, runtime, workspaceSince, onOpenTab, active, onTitleChange, askUserItems, setAskUserItems, designPlanItems, setDesignPlanItems, onCloseTab }: PreviewContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const clampZoom = (value: number) => Math.min(200, Math.max(50, Math.round(value / 10) * 10));
  const toggleFullscreen = () => {
    if (!contentRef.current) return;
    if (document.fullscreenElement === contentRef.current) {
      void document.exitFullscreen();
      return;
    }
    void contentRef.current.requestFullscreen();
  };
  const openPopup = () => {
    const base = `${window.location.pathname}${window.location.search}`;
    window.open(`${base}#/preview-window/${tab.id}`, '_blank', 'width=920,height=720');
  };
  const controls = (
    <div className="preview-content-controls">
      <div className="preview-zoom-controls">
        <button title="缩小" onClick={() => onZoomChange(clampZoom(zoom - 10))}>-</button>
        <span>{Math.round(zoom)}%</span>
        <button title="放大" onClick={() => onZoomChange(clampZoom(zoom + 10))}>+</button>
      </div>
      <button className="preview-content-tool" title="全屏" onClick={toggleFullscreen}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3" />
        </svg>
      </button>
      <button className="preview-content-tool" title="弹出独立窗口" onClick={openPopup}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M14 5h5v5M19 5l-7 7M11 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5" />
        </svg>
      </button>
    </div>
  );

  if (tab.kind === 'newtab') return <NewTabPreview onOpenTab={onOpenTab} />;

  const isHtmlFile =
    tab.kind === 'file' &&
    tab.payload.kind === 'file' &&
    tab.payload.source === 'workspace' &&
    (tab.payload.ext || fileExtension(tab.payload.name ?? tab.payload.path ?? '')) === 'html';

  // browser 标签需要常驻挂载:非激活时通过 display:none 隐藏,避免卸载导致历史丢失。
  const isHiddenBrowser = tab.kind === 'browser' && active === false;

  return (
    <div className="preview-content" ref={contentRef} style={isHiddenBrowser ? { display: 'none' } : undefined}>
      {tab.kind === 'summary' && (
        <>
          <div className="preview-content-toolbar">{controls}</div>
          {/* 同上:CSS zoom 取比例值,不能直接用百分比数字 */}
          <div className="preview-zoom-root" style={{ zoom: zoom / 100 }}>
            <TaskMonitor rawMessages={rawMessages ?? []} threadId={threadId ?? ''} workspaceSince={workspaceSince ?? 0} />
          </div>
        </>
      )}
      {tab.kind === 'eda' && (
        <>
          <div className="preview-content-toolbar">{controls}</div>
          {/* 同上:CSS zoom 取比例值,不能直接用百分比数字 */}
          <div className="preview-zoom-root" style={{ zoom: zoom / 100 }}>
            <div className="preview-eda-card">
              <div className="preview-note">EDA 渲染器接入中</div>
              <div className="preview-eda-name">{tab.title}</div>
            </div>
          </div>
        </>
      )}
      {tab.kind === 'file' && tab.payload.kind === 'file' && (
        isHtmlFile ? (
          <FilePreview payload={tab.payload} controls={controls} zoom={zoom} />
        ) : (
          <>
            <div className="preview-content-toolbar">{controls}</div>
            {/* 同上:CSS zoom 取比例值,不能直接用百分比数字 */}
            <div className="preview-zoom-root" style={{ zoom: zoom / 100 }}>
              <FilePreview payload={tab.payload} />
            </div>
          </>
        )
      )}
      {tab.kind === 'browser' && tab.payload.kind === 'browser' && (
        <div className="preview-browser-shell">
          <BrowserPreview url={tab.payload.url} active={active ?? true} onTitleChange={onTitleChange ?? (() => {})} />
        </div>
      )}
      {tab.kind === 'artifact-tag' && tab.payload.kind === 'artifact-tag' && (
        <>
          <div className="preview-content-toolbar">{controls}</div>
          <div className="preview-zoom-root" style={{ zoom: zoom / 100 }}>
            {tab.payload.artifactType === 'html' && (
              <DesignWorkspace
                title={tab.payload.title}
                content={tab.payload.content}
                runtime={runtime}
              />
            )}
            {tab.payload.artifactType === 'slides' && (
              <SlidesWorkspace title={tab.payload.title} content={tab.payload.content} />
            )}
            {tab.payload.artifactType === 'doc' && (
              <DocViewer title={tab.payload.title} content={tab.payload.content} />
            )}
          </div>
        </>
      )}
      {tab.kind === 'askuser' && (
        <div className="preview-zoom-root">
          {!askUserItems || askUserItems.length === 0 ? (
            <div className="preview-state">暂无等待回答的问题</div>
          ) : (
            <AskUserPanel
              threadId={threadId ?? ''}
              data={askUserItems[0]}
              onSubmitted={() => {
                setAskUserItems?.(items => items.slice(1));
                // 提交的是队列里最后一个问题:直接关掉「问题」标签,不留空标签
                // (2026-09-20 用户反馈:回答后应立刻关闭,而不是显示"暂无等待回答的问题")
                if ((askUserItems?.length ?? 0) <= 1) onCloseTab?.(tab.id);
              }}
            />
          )}
        </div>
      )}
      {tab.kind === 'design-plan' && (
        <div className="preview-zoom-root">
          {!designPlanItems || designPlanItems.length === 0 ? (
            <div className="preview-state">暂无待确认的设计计划</div>
          ) : (
            <DesignPlanCard
              threadId={threadId ?? ''}
              data={designPlanItems[0]}
              onSubmitted={() => {
                setDesignPlanItems?.(items => items.slice(1));
                if ((designPlanItems?.length ?? 0) <= 1) onCloseTab?.(tab.id);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// drive 提取文本单独加载,父组件不关心接口细节。
function FileTextView({ fileId, onFileName }: { fileId: string; onFileName: (name: string) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/drive/files/${fileId}/text`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok || data.error || data.text === undefined) throw new Error(data.error ?? `读取失败: ${res.status}`);
        setText(data.text);
        if (typeof data.name === 'string') onFileName(data.name);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fileId, onFileName]);

  if (loading) return <div className="preview-spinner" aria-label="文本加载中" />;
  if (error) return <div className="preview-state">{error}</div>;
  return <pre className="preview-code">{text}</pre>;
}

export function PreviewPanel({
  threadId,
  rawMessages,
  workspaceSince,
  runtime,
  tabs,
  activeTabId,
  onTabsChange,
  onActivate,
  onClose,
}: PreviewPanelProps) {
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceEntry[]>([]);
  const [workspaceError, setWorkspaceError] = useState('');

  // 结构化提问待决列表:与 ChatThread 的审批轮询同源(GET /sandbox/approvals),
  // 这里只关心 ask_user 型挂起。PreviewPanel 在 ChatThread 之外,拿不到它的
  // PolledApprovalsContext,独立轻量轮询是可接受的最小改动。
  const [askUserItems, setAskUserItems] = useState<
    Array<{ runId: string; toolCallId: string; questions: AskUserQuestion[] }>
  >([]);
  const openedAskUserRunsRef = useRef<Set<string>>(new Set());
  // 设计计划确认待决列表(M16):与 askUserItems 完全独立的轮询,互不干扰。
  const [designPlanItems, setDesignPlanItems] = useState<
    Array<{ runId: string; toolCallId: string; plan: DesignPlanData['plan'] }>
  >([]);
  const openedDesignPlanRunsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/sandbox/approvals?threadId=${encodeURIComponent(threadId)}`);
        if (!res.ok || !alive) return;
        const data = await res.json();
        const items = (data.approvals ?? [])
          .filter((a: any) => a.kind === 'suspended' && a.toolName === 'ask_user')
          .map((a: any) => ({
            runId: a.runId as string,
            toolCallId: a.toolCallId as string,
            questions: ((a.payload as any)?.questions ?? []) as AskUserQuestion[],
          }))
          .filter((item: { runId: string; toolCallId: string; questions: AskUserQuestion[] }) => item.questions.length > 0 && !isDecidedLocally(item.runId, item.toolCallId));
        if (alive) setAskUserItems(items);
      } catch {
        // 后端未启动等:静默
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);

  // 设计计划确认待决列表轮询(M16):与 askUserItems 独立,互不干扰。
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/sandbox/approvals?threadId=${encodeURIComponent(threadId)}`);
        if (!res.ok || !alive) return;
        const data = await res.json();
        const items = (data.approvals ?? [])
          .filter((a: any) => a.kind === 'suspended' && a.toolName === 'enter_design_plan')
          .map((a: any) => ({
            runId: a.runId as string,
            toolCallId: a.toolCallId as string,
            plan: (a.payload as any)?.plan,
          }))
          .filter((item: any) => item.plan != null && !isDecidedLocally(item.runId, item.toolCallId));
        if (alive) setDesignPlanItems(items);
      } catch {
        // 后端未启动等:静默
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);

  // 打开或聚焦标签;同 payload 已存在时只激活,不重复生成标签。
  const openTab = useCallback((kind: PreviewTab['kind'], title: string, payload: PreviewPayload) => {
    if (kind === 'newtab') return;
    const existing = tabs.find(tab => tab.kind === kind && samePayload(tab.payload, payload));
    if (existing) {
      onActivate(existing.id);
      rememberRecentTab(existing);
      return;
    }
    const tab: PreviewTab = {
      id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      title,
      payload,
    };
    onTabsChange([...tabs, tab]);
    onActivate(tab.id);
    rememberRecentTab(tab);
  }, [tabs, onTabsChange, onActivate]);

  // 新标签页允许多个同时存在,因此不走同 payload 去重逻辑。
  const addNewTab = useCallback(() => {
    const tab: PreviewTab = {
      id: `newtab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'newtab',
      title: '新标签页',
      payload: { kind: 'newtab' },
    };
    onTabsChange([...tabs, tab]);
    onActivate(tab.id);
  }, [tabs, onTabsChange, onActivate]);

  const updateTabZoom = useCallback((id: string, zoom: number) => {
    onTabsChange(tabs.map(tab => (tab.id === id ? { ...tab, zoom } : tab)));
  }, [tabs, onTabsChange]);

  const updateTabTitle = useCallback((id: string, title: string) => {
    onTabsChange(tabs.map(tab => (tab.id === id ? { ...tab, title } : tab)));
  }, [tabs, onTabsChange]);

  // 关闭当前签后优先激活相邻签;关闭最后一个签时回到空态。
  const closeTab = (id: string) => {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const next = tabs.filter(tab => tab.id !== id);
    onTabsChange(next);
    if (activeTabId === id) {
      const neighbor = next[Math.min(index, next.length - 1)];
      onActivate(neighbor?.id ?? '');
    }
  };

  // 标签页右键菜单(2026-09-18 用户需求):关闭/关闭其他/关闭右侧
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  const closeOthers = (id: string) => {
    const target = tabs.find(tab => tab.id === id);
    if (!target) return;
    onTabsChange([target]);
    onActivate(id);
  };

  const closeToRight = (id: string) => {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const kept = tabs.slice(0, index + 1);
    onTabsChange(kept);
    // 原激活签被关掉时,回落到右键的那个签
    if (!kept.some(tab => tab.id === activeTabId)) onActivate(id);
  };

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/workspace/files`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `加载失败: ${res.status}`);
        setWorkspaceFiles((data.entries ?? []).filter((entry: WorkspaceEntry) => entry.type === 'file'));
      } catch (err) {
        setWorkspaceError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const handleTabWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return;
    event.currentTarget.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  // 右键菜单用原生事件委托绑在 document 上(而非 React onContextMenu):
  // 任何祖先层的事件拦截/委托差异都不影响,且可命中 tab 栏任意位置。
  // 渲染走 createPortal(document.body),避开面板内祖先的定位/裁剪上下文。
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const tabEl = target?.closest?.('.preview-tab') as HTMLElement | null;
      if (!tabEl) return;
      const tabId = tabEl.dataset.tabId;
      if (!tabId) return;
      event.preventDefault();
      setTabContextMenu({ x: event.clientX, y: event.clientY, tabId });
    };
    const dismiss = () => setTabContextMenu(null);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, []);

  // 有新的 ask_user 挂起时自动打开「问题」标签;同一 runId 只自动开一次,
  // 用户手动关闭后不再为同一 runId 反复重开。
  useEffect(() => {
    for (const item of askUserItems) {
      if (openedAskUserRunsRef.current.has(item.runId)) continue;
      openedAskUserRunsRef.current.add(item.runId);
      openTab('askuser', '问题', { kind: 'askuser' });
    }
  }, [askUserItems, openTab]);

  // 有新的设计计划确认挂起时自动打开「设计计划」标签;同一 runId 只自动开一次。
  useEffect(() => {
    for (const item of designPlanItems) {
      if (openedDesignPlanRunsRef.current.has(item.runId)) continue;
      openedDesignPlanRunsRef.current.add(item.runId);
      openTab('design-plan', '设计计划', { kind: 'design-plan' });
    }
  }, [designPlanItems, openTab]);

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  return (
    <aside className="preview-panel">
            <div className="preview-tabs">
              <div className="preview-tabs-scroll" onWheel={handleTabWheel}>
                {tabs.map(tab => {
                  const ext =
                    tab.kind === 'file' && tab.payload.kind === 'file'
                      ? tab.payload.ext || fileExtension(tab.payload.name ?? tab.payload.path ?? '')
                      : undefined;
                  return (
                    <div
                      key={tab.id}
                      data-tab-id={tab.id}
                      className={`preview-tab${tab.id === activeTabId ? ' is-active' : ''}`}
                      onClick={() => onActivate(tab.id)}
                    >
                      <TabIcon ext={ext} kind={tab.kind} />
                      <span className="preview-tab-title">{tab.title}</span>
                      <button
                        className="preview-tab-close"
                        onClick={event => {
                          event.stopPropagation();
                          closeTab(tab.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="preview-tabs-actions">
                <button className="preview-tab-add" title="新建标签页" onClick={addNewTab}>
                  +
                </button>
                <button className="preview-panel-close" onClick={onClose} title="关闭预览面板">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
      {activeTab || tabs.some(tab => tab.kind === 'browser') ? (
        <>
          {tabs.map(tab => {
            const isActive = tab.id === activeTabId;
            // 非 browser 标签仍只在激活时渲染;browser 标签全部常驻挂载,用 display 控制显隐。
            if (tab.kind !== 'browser' && !isActive) return null;
            return (
              <PreviewContent
                key={tab.id}
                tab={tab}
                active={isActive}
                zoom={tab.zoom ?? 100}
                onZoomChange={zoom => updateTabZoom(tab.id, zoom)}
                threadId={threadId}
                rawMessages={rawMessages}
                runtime={runtime}
                workspaceSince={workspaceSince}
                onOpenTab={openTab}
                onTitleChange={title => updateTabTitle(tab.id, title)}
                askUserItems={askUserItems}
                setAskUserItems={setAskUserItems}
                designPlanItems={designPlanItems}
                setDesignPlanItems={setDesignPlanItems}
                onCloseTab={closeTab}
              />
            );
          })}
        </>
      ) : (
        <div className="preview-empty">
          <button className="preview-open-summary" onClick={() => openTab('summary', '任务监控', { kind: 'summary' })}>
            打开任务监控
          </button>
          <div className="preview-file-head">工作区文件</div>
          {workspaceError && <div className="preview-state">{workspaceError}</div>}
          {!workspaceError && workspaceFiles.length === 0 && <div className="preview-state">暂无文件</div>}
          <div className="preview-file-list">
            {workspaceFiles.map(entry => (
              <button
                key={entry.path}
                className="preview-file-item"
                onClick={() =>
                  openTab('file', entry.name, {
                    kind: 'file',
                    source: 'workspace',
                    path: entry.path,
                    name: entry.name,
                    ext: fileExtension(entry.name),
                  })
                }
              >
                {entry.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {tabContextMenu &&
        createPortal(
          <div
            className="preview-tab-context-menu"
            style={{
              left: Math.min(tabContextMenu.x - 12, window.innerWidth - 170),
              top: Math.min(tabContextMenu.y + 4, window.innerHeight - 120),
            }}
            onMouseDown={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="preview-tab-context-item"
              onClick={() => {
                closeTab(tabContextMenu.tabId);
                setTabContextMenu(null);
              }}
            >
              关闭
            </button>
          <button
            type="button"
            className="preview-tab-context-item"
            onClick={() => {
              closeOthers(tabContextMenu.tabId);
              setTabContextMenu(null);
            }}
          >
            关闭其他标签页
          </button>
          <button
            type="button"
            className="preview-tab-context-item"
            onClick={() => {
              closeToRight(tabContextMenu.tabId);
              setTabContextMenu(null);
            }}
          >
            关闭右侧标签页
          </button>
          </div>,
          document.body,
        )}
    </aside>
  );
}