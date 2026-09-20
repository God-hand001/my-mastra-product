import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PreviewContent, type PreviewTab } from '../components/PreviewPanel';

type PreviewSyncMessage =
  | { type: 'payload'; tabId: string; tab: PreviewTab; threadId: string }
  | { type: 'zoom'; tabId: string; zoom: number };

// 独立预览弹窗:内容仍由主窗下发,缩放通过 BroadcastChannel 双向同步。
export function PreviewWindowPage() {
  const { tabId = '' } = useParams();
  const [tab, setTab] = useState<PreviewTab | null>(null);
  const [threadId, setThreadId] = useState('');
  const [zoom, setZoom] = useState(100);
  const zoomBroadcastRef = useRef<number | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel('h0-preview-sync');
    channel.postMessage({ type: 'request-payload', tabId });
    channel.onmessage = event => {
      const message = event.data as PreviewSyncMessage;
      if (message.tabId !== tabId) return;
      if (message.type === 'payload') {
        setTab(message.tab);
        setThreadId(message.threadId);
        setZoom(message.tab.zoom ?? 100);
        return;
      }
      if (message.type === 'zoom' && Number.isFinite(message.zoom)) {
        // 远端缩放只应用到本地,不再回播,避免两侧同步形成循环。
        setZoom(message.zoom);
      }
    };

    const handleBeforeUnload = () => {
      channel.postMessage({ type: 'window-closed', tabId });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      channel.postMessage({ type: 'window-closed', tabId });
      channel.close();
    };
  }, [tabId]);

  useEffect(() => {
    return () => {
      if (zoomBroadcastRef.current !== null) window.clearTimeout(zoomBroadcastRef.current);
    };
  }, []);

  const handleZoomChange = (nextZoom: number) => {
    setZoom(nextZoom);
    if (zoomBroadcastRef.current !== null) window.clearTimeout(zoomBroadcastRef.current);
    zoomBroadcastRef.current = window.setTimeout(() => {
      const channel = new BroadcastChannel('h0-preview-sync');
      channel.postMessage({ type: 'zoom', tabId, zoom: nextZoom });
      channel.close();
    }, 100);
  };

  return (
    <div className="preview-window-page">
      {tab ? (
        <PreviewContent tab={tab} zoom={zoom} onZoomChange={handleZoomChange} threadId={threadId} />
      ) : (
        <div className="preview-state">正在从主窗口同步预览内容...</div>
      )}
    </div>
  );
}
