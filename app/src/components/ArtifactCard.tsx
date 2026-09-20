// 产物长卡：类型图标 + 大小 + 内联预览 + 三点菜单
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE } from '../lib/apiBase';
import { formatSize } from '../lib/driveClient';
import type { Artifact } from '../lib/artifacts';
import { renderPptxWithSanitize, type PptxPreviewer } from '../lib/pptxPreview';
import '../styles/preview-pptx.css';

type AppInfo = {
  id: string;
  name: string;
  iconDataUrl?: string;
  isDefault?: boolean;
};

function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function FileIcon({ ext }: { ext: string }) {
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
  if (item) {
    return <span className='artifact-icon' style={{ backgroundColor: item.bg }}>{item.label}</span>;
  }

  return (
    <span className='artifact-icon' style={{ backgroundColor: '#6b7280' }}>
      <svg
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.7'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
      >
        <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' />
        <path d='M14 2v6h6' />
      </svg>
    </span>
  );
}

function useArtifactSize(path: string) {
  const [size, setSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(API_BASE + '/workspace/files/stat?path=' + encodeURIComponent(path))
      .then((res) => {
        if (!res.ok) throw new Error('stat ' + res.status);
        return res.json() as Promise<{ size?: number }>;
      })
      .then((data) => {
        if (cancelled) return;
        if (typeof data.size === 'number') setSize(data.size);
        else throw new Error('未返回 size');
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { size, loading, error };
}

const MAIN_ITEMS = ['打开', '打开文件夹', '另存为', '复制路径', '打开方式'] as const;
type MainIndex = 0 | 1 | 2 | 3 | 4;

// 菜单项线性图标(对齐千问观感:每项都有 16px 线性图标)
function MenuItemIcon({ index }: { index: MainIndex }) {
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
  switch (index) {
    case 0: // 打开:文档
      return (
        <svg {...common}>
          <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' />
          <path d='M14 2v6h6' />
        </svg>
      );
    case 1: // 打开文件夹
      return (
        <svg {...common}>
          <path d='M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1' />
          <path d='m2.5 19.5 2.3-6.1A2 2 0 0 1 6.7 12h13.1a1 1 0 0 1 .94 1.34l-2.1 5.66a2 2 0 0 1-1.87 1.3H4.5' />
        </svg>
      );
    case 2: // 另存为:软盘
      return (
        <svg {...common}>
          <path d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z' />
          <path d='M17 21v-8H7v8M7 3v5h8' />
        </svg>
      );
    case 3: // 复制路径
      return (
        <svg {...common}>
          <rect x='9' y='9' width='11' height='11' rx='2' />
          <path d='M15 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5' />
        </svg>
      );
    default: // 打开方式:应用窗口
      return (
        <svg {...common}>
          <rect x='2' y='4' width='20' height='16' rx='2' />
          <path d='M2 9h20' />
        </svg>
      );
  }
}

function ArtifactMenu({ artifact, onClose }: { artifact: Artifact; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // 「打开方式」触发项:子菜单 Portal 的定位锚点
  const subTriggerRef = useRef<HTMLSpanElement>(null);
  const [subPos, setSubPos] = useState({ top: 0, left: 0 });
  // 主菜单面板(Portal)与其定位:按三点按钮锚定,空间不足时向上/向左翻转
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  // 子菜单面板(Portal):外部点击判断需要它的包含关系
  const subPanelRef = useRef<HTMLDivElement>(null);
  const mainItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const subItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeMain, setActiveMain] = useState<MainIndex>(0);
  const [activeSub, setActiveSub] = useState(0);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setSubOpen(false);
    setError(null);
    onClose?.();
    buttonRef.current?.focus();
  }, [onClose]);

  const showError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(id);
  }, [error]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // 菜单与子菜单都渲染到 body(Portal),不在 menuRef 的 DOM 子树内 ——
      // 必须逐个判断包含关系,否则点子菜单项会被当成"点击外部"先关掉菜单,
      // click 事件随之丢失,表现为"点击没用"(2026-09-18 用户反馈)
      const inWrap = menuRef.current?.contains(t) ?? false;
      const inPanel = menuPanelRef.current?.contains(t) ?? false;
      const inSub = subPanelRef.current?.contains(t) ?? false;
      if (!inWrap && !inPanel && !inSub) closeMenu();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, closeMenu]);

  const handleOpen = async () => {
    setError(null);
    try {
      const res = await fetch(API_BASE + '/workspace/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: artifact.path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        throw new Error(String(data.error ?? ('状态码 ' + res.status)));
      }
      closeMenu();
    } catch (err) {
      showError('打开失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleReveal = async () => {
    setError(null);
    try {
      const res = await fetch(API_BASE + '/workspace/files/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: artifact.path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        throw new Error(String(data.error ?? ('状态码 ' + res.status)));
      }
      closeMenu();
    } catch (err) {
      showError('定位失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleSaveAs = () => {
    setError(null);
    const url = API_BASE + '/workspace/files/raw?path=' + encodeURIComponent(artifact.path) + '&download=1';
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    closeMenu();
  };

  const handleCopyPath = async () => {
    setError(null);
    try {
      const res = await fetch(API_BASE + '/workspace/files/stat?path=' + encodeURIComponent(artifact.path));
      if (!res.ok) throw new Error('状态码 ' + res.status);
      const data = (await res.json()) as { absolutePath?: string };
      if (!data.absolutePath) throw new Error('未返回绝对路径');
      await navigator.clipboard.writeText(data.absolutePath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      showError('复制失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    setApps([]);
    setDegraded(false);
    try {
      const res = await fetch(API_BASE + '/workspace/files/openwith?path=' + encodeURIComponent(artifact.path));
      if (!res.ok) throw new Error('状态码 ' + res.status);
      const data = (await res.json()) as { apps?: AppInfo[]; degraded?: boolean };
      setApps(data.apps ?? []);
      setDegraded(data.degraded ?? false);
    } catch (err) {
      setApps([]);
      setDegraded(true);
      showError('获取应用失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAppsLoading(false);
    }
  }, [artifact.path, showError]);

  // 主菜单定位:按三点按钮锚定,右侧/底部空间不足时翻转,保证整块可见
  useEffect(() => {
    if (!open) return;
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = 188;
    const height = 5 * 38 + 12; // 5 项 + padding，够用的估算值
    let left = r.right - width;
    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, r.top - height - 6); // 向上翻转
    }
    setMenuPos({ top, left });
  }, [open]);

  // 打开子菜单:位置按主菜单面板边缘贴边并排(不与主菜单重叠),空间不足则改到左侧
  const openSubmenu = useCallback(() => {
    setSubOpen(true);
    const panel = menuPanelRef.current;
    const trigger = subTriggerRef.current;
    if (!panel || !trigger) return;
    const pr = panel.getBoundingClientRect();
    const tr = trigger.getBoundingClientRect();
    const width = 232;
    let left = pr.right + 4;
    if (left + width > window.innerWidth - 8) left = pr.left - width - 4; // 朝左翻转
    if (left < 8) left = 8;
    let top = tr.top - 6;
    const estHeight = Math.min(56 + Math.max(apps.length, 3) * 40, window.innerHeight - 16);
    if (top + estHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - estHeight - 8);
    }
    setSubPos({ top, left });
  }, [apps.length]);

  useEffect(() => {
    if (subOpen) {
      setActiveSub(0);
      void loadApps();
    }
  }, [subOpen, loadApps]);

  const openWithApp = async (appId: string) => {
    setError(null);
    try {
      const res = await fetch(API_BASE + '/workspace/files/open-with', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: artifact.path, appId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        throw new Error(String(data.error ?? ('状态码 ' + res.status)));
      }
      closeMenu();
    } catch (err) {
      showError('打开方式失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const executeMain = (index: MainIndex) => {
    switch (index) {
      case 0:
        return handleOpen();
      case 1:
        return handleReveal();
      case 2:
        return handleSaveAs();
      case 3:
        return handleCopyPath();
      case 4:
        // 走 openSubmenu 而非直接 setSubOpen:键盘路径同样需要计算贴边位置
        return openSubmenu();
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (subOpen) {
          setSubOpen(false);
          setActiveMain(4);
          mainItemRefs.current[4]?.focus();
        } else {
          closeMenu();
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (subOpen) {
          if (apps.length > 0) setActiveSub((i) => (i + 1) % apps.length);
        } else {
          setActiveMain((i) => ((((i + 1) % 5) + 5) % 5) as MainIndex);
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (subOpen) {
          if (apps.length > 0) setActiveSub((i) => (i - 1 + apps.length) % apps.length);
        } else {
          setActiveMain((i) => ((((i - 1) % 5) + 5) % 5) as MainIndex);
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (subOpen) {
          const app = apps[activeSub];
          if (app) openWithApp(app.id);
        } else {
          executeMain(activeMain);
        }
        return;
      }
      if (e.key === 'ArrowRight' && !subOpen && activeMain === 4) {
        e.preventDefault();
        setSubOpen(true);
        return;
      }
      if (e.key === 'ArrowLeft' && subOpen) {
        e.preventDefault();
        setSubOpen(false);
        setActiveMain(4);
        mainItemRefs.current[4]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, subOpen, activeMain, activeSub, apps, closeMenu]);

  useEffect(() => {
    if (open && !subOpen) {
      mainItemRefs.current[activeMain]?.focus();
    }
  }, [open, subOpen, activeMain]);

  useEffect(() => {
    if (open && subOpen) {
      subItemRefs.current[activeSub]?.focus();
    }
  }, [open, subOpen, activeSub, apps.length]);

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((v) => !v);
    setSubOpen(false);
    setError(null);
    setActiveMain(0);
  };

  const hasApps = apps.length > 0 && !degraded;

  return (
    <div
      ref={menuRef}
      className='artifact-menu-wrap'
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type='button'
        aria-label='文件操作菜单'
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={toggleMenu}
        className='artifact-menu-button'
      >
        <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
          <circle cx='12' cy='6' r='2' />
          <circle cx='12' cy='12' r='2' />
          <circle cx='12' cy='18' r='2' />
        </svg>
      </button>
      {open &&
        createPortal(
          /* 主菜单也走 Portal + fixed:嵌套 absolute 在卡片靠视口底部时会被裁剪,
             表现为"只剩打开一项"(2026-09-18 用户反馈图3) */
          <div
            ref={menuPanelRef}
            className='artifact-menu'
            role='menu'
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {MAIN_ITEMS.map((label, idx) => {
              const index = idx as MainIndex;
              return (
                <div
                  key={label}
                  ref={(el) => {
                    mainItemRefs.current[index] = el;
                  }}
                  role='menuitem'
                  tabIndex={0}
                  className={`artifact-menu-item${index === 4 && subOpen ? ' is-subopen' : ''}`}
                  onClick={() => executeMain(index)}
                  onMouseEnter={() => {
                    setActiveMain(index);
                    if (index === 4) openSubmenu();
                    else setSubOpen(false);
                  }}
                >
                  <span className='artifact-menu-icon' aria-hidden='true'>
                    <MenuItemIcon index={index} />
                  </span>
                  <span className='artifact-menu-label'>{index === 3 && copied ? '已复制' : label}</span>
                  {index === 4 && (
                    <span className='artifact-menu-chev' ref={subTriggerRef}>
                      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                        <path d='m9 18 6-6-6-6' />
                      </svg>
                    </span>
                  )}
                </div>
              );
            })}
            {error && (
              <div className='artifact-menu-error'>
                {error}
              </div>
            )}
          </div>,
          document.body,
        )}
      {open && subOpen &&
        createPortal(
          /* 子菜单同样 Portal + fixed,并按主菜单面板边缘贴边并排(不与主菜单重叠) */
          <div
            ref={subPanelRef}
            className='artifact-submenu'
            role='menu'
            style={{ position: 'fixed', top: subPos.top, left: subPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {appsLoading && (
              <div className='artifact-submenu-empty'>正在获取应用…</div>
            )}
            {!appsLoading && !hasApps && (
              <div className='artifact-submenu-empty'>没有可用的应用</div>
            )}
            {!appsLoading &&
              hasApps &&
              apps.map((app, i) => (
                <div
                  key={app.id}
                  ref={(el) => {
                    subItemRefs.current[i] = el;
                  }}
                  role='menuitem'
                  tabIndex={0}
                  className='artifact-submenu-item'
                  onClick={(e) => {
                    e.stopPropagation();
                    openWithApp(app.id);
                  }}
                  onMouseEnter={() => setActiveSub(i)}
                >
                  {app.iconDataUrl ? (
                    <img src={app.iconDataUrl} alt='' width={16} height={16} className='artifact-openwith-icon' />
                  ) : (
                    <svg
                      width='16'
                      height='16'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='1.7'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      aria-hidden='true'
                    >
                      <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' />
                      <path d='M14 2v6h6' />
                    </svg>
                  )}
                  <span className='artifact-openwith-name'>{app.name}</span>
                  {app.isDefault && (
                    <span className='artifact-default-badge'>（默认）</span>
                  )}
                </div>
              ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function InlinePreview({ artifact, ext }: { artifact: Artifact; ext: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<PptxPreviewer | null>(null);
  const [failed, setFailed] = useState(false);

  const openArtifact = useCallback(() => {
    window.dispatchEvent(new CustomEvent('h0-open-artifact', { detail: artifact }));
  }, [artifact]);

  useEffect(() => {
    if (ext !== 'pptx') return;
    const container = containerRef.current;
    if (!container) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const url = API_BASE + '/workspace/files/raw?path=' + encodeURIComponent(artifact.path);
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('加载失败 ' + res.status);
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;
        await renderPptxWithSanitize(
          container,
          arrayBuffer,
          p => {
            previewerRef.current = p;
          },
          { firstSlideOnly: true },
        );
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      try {
        previewerRef.current?.destroy();
      } catch {
        // ignore
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [artifact.path, ext]);

  if (ext === 'pptx') {
    return (
      <div className='artifact-inline artifact-inline-pptx'>
        <div ref={containerRef} />
        {failed && (
          <div
            className='artifact-inline-fail'
            onClick={openArtifact}
          >
            预览加载失败，点击卡片在预览栏打开
          </div>
        )}
      </div>
    );
  }

  if (ext === 'html' || ext === 'htm') {
    return (
      <div className='artifact-inline artifact-inline-html'>
        {/* 用 sandbox=allow-scripts 隔离宿主页面与会话数据，不加 allow-same-origin。
            用 srcDoc 而非 src 外链:file:// 壳页面嵌 http://localhost 子框架会被
            Chromium 拦截(PNA/协议限制)导致白板;内容内联注入则无跨协议问题 */}
        <HtmlFrame path={artifact.path} name={artifact.name} />
        <div
          onClick={openArtifact}
          className='artifact-inline-overlay'
          aria-hidden='true'
        />
      </div>
    );
  }

  return null;
}

// html 内联预览的加载组件:fetch raw 内容后经 srcDoc 注入。
// srcDoc 内容内联,避开 file:// 壳对 http 子框架的加载限制;失败显示降级提示。
function HtmlFrame({ path, name }: { path: string; name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API_BASE + '/workspace/files/raw?path=' + encodeURIComponent(path), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('加载失败 ' + res.status);
        const text = await res.text();
        if (!cancelled) setHtml(text);
      } catch (err) {
        if ((err as Error).name !== 'AbortError' && !cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path]);

  if (failed) {
    return <div className='artifact-inline-fail'>预览加载失败，点击卡片在预览栏打开</div>;
  }
  return (
    <iframe
      srcDoc={html ?? ''}
      sandbox='allow-scripts'
      className='artifact-inline-frame'
      title={name + ' 内联预览'}
    />
  );
}

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const ext = getExt(artifact.name);
  const { size, loading: sizeLoading, error: sizeError } = useArtifactSize(artifact.path);

  const openArtifact = () => {
    window.dispatchEvent(new CustomEvent('h0-open-artifact', { detail: artifact }));
  };

  const typeLabel = ext.toUpperCase() || '文件';
  let subtitle = typeLabel;
  if (sizeLoading) {
    subtitle = typeLabel + ' · …';
  } else if (!sizeError && size !== null) {
    subtitle = typeLabel + ' · ' + formatSize(size);
  }

  return (
    <div
      className='artifact-long-card'
      onClick={openArtifact}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openArtifact();
        }
      }}
      role='button'
      tabIndex={0}
      aria-label={artifact.name}
    >
      <div className='artifact-long-card-head'>
        <FileIcon ext={ext} />
        <div className='artifact-info'>
          <div className='artifact-name'>
            {artifact.name}
          </div>
          <div className='artifact-sub'>
            {subtitle}
          </div>
        </div>
        <ArtifactMenu artifact={artifact} />
      </div>
      <InlinePreview artifact={artifact} ext={ext} />
    </div>
  );
}
