// 内置浏览器视图:封装 Electron <webview>、地址栏、导航控件与「交给 agent」动作。
// 浏览器标签会常驻挂载,因此本组件外层通过 display 控制显隐,自身不主动卸载。
import { useEffect, useRef, useState } from 'react';
import { isDesktop } from '../lib/desktop';
import { resolveUrlInput } from '../lib/urlInput';

// React 19 的 @types/react 已经内置了 <webview> 的 TS 类型(使用 HTMLWebViewElement),
// 但 DOM 标准里没有声明 Electron 专用方法,这里通过全局 interface merging 补上。
declare global {
  interface HTMLWebViewElement {
    src: string;
    webpreferences: string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
    loadURL(url: string): void;
    getURL(): string;
    executeJavaScript(code: string): Promise<unknown>;
  }
}

// 本组件内部统一用这个别名,避免大小写混淆。
type WebviewElement = HTMLWebViewElement;

const MAX_TEXT_LENGTH = 8000;

export type BrowserPreviewProps = {
  url: string;
  active: boolean;
  onTitleChange: (title: string) => void;
};

// 16px 线性 SVG 图标,风格与项目 SidebarIcon 对齐:无 fill、stroke currentColor、1.7 线宽。
function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v14a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M5 10h14" />
      <path d="M5 14h14" />
    </svg>
  );
}

export function BrowserPreview({ url, active, onTitleChange }: BrowserPreviewProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [address, setAddress] = useState(url);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [error, setError] = useState<{ code: number; description: string } | null>(null);
  const [addressHint, setAddressHint] = useState('');
  const [agentHint, setAgentHint] = useState('');

  // url 属性由外部变更(如打开新页)时,同步地址栏与实际地址。
  useEffect(() => {
    setAddress(url);
    setCurrentUrl(url);
  }, [url]);

  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;

    // canGoBack/canGoForward 只有在 webview 内部 WebContents attach 完成后才可调用。
    // 元素刚进 DOM 时 attach 还没结束,此时调用会抛错 —— 而本项目没有 error boundary,
    // 渲染期抛错会卸载整棵 React 树,表现为整个应用白屏(不只是预览面板)。
    // 因此这里统一 try/catch,并把首次刷新推迟到 dom-ready 之后。
    const updateNavigation = () => {
      try {
        setCanGoBack(el.canGoBack());
        setCanGoForward(el.canGoForward());
      } catch {
        // attach 未完成,保持当前状态,后续 dom-ready / did-navigate 会再刷新
      }
    };

    // 开始加载时清空错误态,停止加载后刷新前进/后退可用性。
    const onStart = () => {
      setLoading(true);
      setError(null);
    };
    const onStop = () => {
      setLoading(false);
      updateNavigation();
    };

    // 页面标题变化时回填到标签标题。
    const onTitle = (event: Event) => {
      const evt = event as unknown as { title: string };
      if (evt.title) onTitleChange(evt.title);
    };

    // 导航完成后同步地址栏与当前地址,并刷新导航按钮状态。
    const onNavigate = (event: Event) => {
      const evt = event as unknown as { url: string };
      if (evt.url) {
        setAddress(evt.url);
        setCurrentUrl(evt.url);
      }
      updateNavigation();
    };

    // did-fail-load 回调:event.errorCode / event.errorDescription 等属性直接挂在事件对象上。
    // errorCode === -3 为 ERR_ABORTED(重定向或用户取消导致的中断),不视为真正失败。
    const onFail = (event: Event) => {
      const evt = event as unknown as {
        errorCode: number;
        errorDescription: string;
        isMainFrame: boolean;
      };
      if (evt.errorCode === -3) return;
      // 只把主框架的真实错误展示出来,子资源失败不覆盖整页。
      if (!evt.isMainFrame) return;
      setError({ code: evt.errorCode, description: evt.errorDescription });
    };

    // Electron 自定义事件名不在标准 DOM 类型里,把元素当成 EventTarget 来添加/移除监听。
    const target = el as unknown as EventTarget;
    target.addEventListener('did-start-loading', onStart);
    target.addEventListener('did-stop-loading', onStop);
    target.addEventListener('page-title-updated', onTitle);
    target.addEventListener('did-navigate', onNavigate);
    target.addEventListener('did-navigate-in-page', onNavigate);
    target.addEventListener('did-fail-load', onFail);

    // attach 完成后才刷新导航按钮:不能在此处同步调用 updateNavigation(),
    // 那时 WebContents 尚未 attach,canGoBack() 会抛错。
    target.addEventListener('dom-ready', updateNavigation);

    return () => {
      target.removeEventListener('did-start-loading', onStart);
      target.removeEventListener('did-stop-loading', onStop);
      target.removeEventListener('page-title-updated', onTitle);
      target.removeEventListener('did-navigate', onNavigate);
      target.removeEventListener('did-navigate-in-page', onNavigate);
      target.removeEventListener('did-fail-load', onFail);
      target.removeEventListener('dom-ready', updateNavigation);
    };
  }, [onTitleChange]);

  // 非激活时不需要真正暂停 webview,只需要上层容器隐藏;这里不处理卸载。

  // 网页宽度适配:仅在页面实际溢出视口时(非响应式桌面页)按比例缩小;
  // 响应式页面(scrollWidth <= 视口)保持 1:1,不做无谓缩放。
  // 上一版用"视口宽/1180"固定比例,响应式站也被缩且容器隐藏时 clientWidth=0 误判成 0.25,
  // 表现为"只显示一点"(2026-09-18 用户二次反馈)。
  const applyZoomFit = () => {
    const el = webviewRef.current;
    const vp = viewportRef.current;
    if (!el || !vp) return;
    const vw = vp.clientWidth;
    if (vw <= 0) return; // 面板隐藏/尚未布局:跳过,等 ResizeObserver 触发
    try {
      const webContents = el as unknown as {
        setZoomFactor: (factor: number) => void;
        executeJavaScript: (code: string) => Promise<number>;
      };
      // 先重置为 1 再测量,否则上一次的 zoom 会影响 scrollWidth,形成反馈循环
      webContents.setZoomFactor(1);
      void webContents
        .executeJavaScript('Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0)')
        .then((scrollWidth) => {
          const factor = scrollWidth > vw + 8 ? Math.max(0.3, vw / scrollWidth) : 1;
          webContents.setZoomFactor(factor);
        })
        .catch(() => {
          // executeJavaScript 不可用(如跨域限制):退回 1:1
          webContents.setZoomFactor(1);
        });
    } catch {
      // webContents 尚未 attach 时抛错,静默等 dom-ready 再试
    }
  };

  useEffect(() => {
    const el = webviewRef.current;
    const vp = viewportRef.current;
    if (!el || !vp) return;
    const onReady = () => applyZoomFit();
    const ro = new ResizeObserver(() => applyZoomFit());
    ro.observe(vp);
    el.addEventListener('dom-ready', onReady);
    el.addEventListener('did-navigate', onReady);
    return () => {
      ro.disconnect();
      el.removeEventListener('dom-ready', onReady);
      el.removeEventListener('did-navigate', onReady);
    };
    // url 变化时 webview 元素不变,但重新挂一次监听确保新页面首帧前已绑定
  }, [url]);

  const handleAddressKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const el = webviewRef.current;
    if (!el) return;

    const result = resolveUrlInput(address);
    if (result.kind === 'rejected') {
      setAddressHint(result.reason);
      return;
    }
    setAddressHint('');
    el.loadURL(result.url);
  };

  const handleAddressChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAddress(event.target.value);
    if (addressHint) setAddressHint('');
  };

  const handleFillComposer = async () => {
    const el = webviewRef.current;
    if (!el) return;
    try {
      const data = (await el.executeJavaScript(
        '({ title: document.title, text: document.body?.innerText ?? "" })'
      )) as { title: string; text: string } | undefined;
      const title = data?.title ?? '';
      const textRaw = data?.text ?? '';
      const text =
        textRaw.length > MAX_TEXT_LENGTH
          ? `${textRaw.slice(0, MAX_TEXT_LENGTH)}…(内容已截断)`
          : textRaw;
      window.dispatchEvent(
        new CustomEvent('h0-fill-composer', {
          detail: { title, url: currentUrl, text },
        })
      );
      setAgentHint('已填入输入框');
    } catch {
      // 取值失败时仍把标题与网址带过去,正文为空,方便用户后续补充。
      window.dispatchEvent(
        new CustomEvent('h0-fill-composer', {
          detail: { title: '', url: currentUrl, text: '' },
        })
      );
      setAgentHint('获取页面内容失败');
    }
  };

  // 网页版直接降级提示,不渲染虚假 webview。
  if (!isDesktop()) {
    return (
      <div className="browser-view">
        <div className="browser-fallback">
          <p>内置浏览器需在桌面端使用</p>
          <p className="browser-fallback-url">{url}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="browser-view">
      <div className="browser-toolbar">
        <button
          type="button"
          className="browser-nav-btn"
          title="后退"
          disabled={!canGoBack}
          onClick={() => webviewRef.current?.goBack()}
        >
          <BackIcon />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          title="前进"
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <ForwardIcon />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          title={loading ? '停止' : '刷新'}
          onClick={() => {
            const el = webviewRef.current;
            if (!el) return;
            loading ? el.stop() : el.reload();
          }}
        >
          {loading ? <StopIcon /> : <RefreshIcon />}
        </button>
        <input
          type="text"
          className="browser-address"
          value={address}
          onChange={handleAddressChange}
          onKeyDown={handleAddressKeyDown}
          placeholder="输入网址或关键词后回车"
        />
        <button
          type="button"
          className="browser-nav-btn"
          title="交给 agent"
          onClick={() => void handleFillComposer()}
        >
          <AgentIcon />
        </button>
      </div>
      {addressHint && <div className="browser-hint">{addressHint}</div>}
      {agentHint && <div className="browser-hint">{agentHint}</div>}
      <div className="browser-viewport" ref={viewportRef}>
        <webview
          ref={webviewRef}
          className="browser-webview"
          src={url}
          webpreferences="nodeIntegration=no,contextIsolation=yes,webSecurity=yes"
        />
        {error && (
          <div className="browser-error">
            <p>无法加载页面</p>
            <p className="browser-error-detail">
              [{error.code}] {error.description}
            </p>
            <button
              type="button"
              className="browser-nav-btn"
              onClick={() => webviewRef.current?.reload()}
            >
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
