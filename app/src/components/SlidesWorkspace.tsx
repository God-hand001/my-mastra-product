import { useState } from 'react';
import { API_BASE } from '../lib/apiBase';

interface SlidesWorkspaceProps {
  title: string;
  content: string; // 完整幻灯片 HTML
}

// slides 产物的三标签工作区(F11):幻灯片(iframe 渲染)/大纲(占位说明)/源文件(源码查看)。
// 大纲 tab 的数据源本应是"会话中模型输出的大纲文本",但那段文本在对话流里已经
// 正常展示过(角色 systemPrompt 要求先出大纲再出产物,大纲不走 <artifact> 标签),
// 这里做成占位说明而不是重复抓取历史消息,避免额外的状态管理复杂度
// (spec 允许的简化,已在 plan.md 里作为技术决策记录)。
export function SlidesWorkspace({ title, content }: SlidesWorkspaceProps) {
  const [tab, setTab] = useState<'deck' | 'outline' | 'source'>('deck');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const exportPptx = async () => {
    setExporting(true);
    setExportError('');
    try {
      const res = await fetch(`${API_BASE}/workspace/export/pptx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: content, title }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `导出失败: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="slides-workspace">
      <div className="slides-workspace-tabs">
        <button type="button" className={tab === 'deck' ? 'is-active' : ''} onClick={() => setTab('deck')}>幻灯片</button>
        <button type="button" className={tab === 'outline' ? 'is-active' : ''} onClick={() => setTab('outline')}>大纲</button>
        <button type="button" className={tab === 'source' ? 'is-active' : ''} onClick={() => setTab('source')}>源文件</button>
        <button type="button" className="slides-export-btn" onClick={exportPptx} disabled={exporting}>
          {exporting ? '导出中…' : '导出 PPTX'}
        </button>
      </div>
      {exportError && <div className="slides-export-error">{exportError}</div>}
      {tab === 'deck' && (
        <div className="slides-deck-canvas">
          <iframe
            className="slides-deck-iframe"
            srcDoc={content}
            sandbox="allow-scripts allow-forms"
            title={title}
          />
        </div>
      )}
      {tab === 'outline' && <div className="slides-outline-placeholder">大纲已在对话中输出，请向上滚动对话查看确认过的大纲内容。</div>}
      {tab === 'source' && (
        <div className="slides-source-view">
          <button
            type="button"
            className="slides-source-copy"
            onClick={() => navigator.clipboard.writeText(content)}
          >
            复制源码
          </button>
          <pre className="preview-code">{content}</pre>
        </div>
      )}
    </div>
  );
}
