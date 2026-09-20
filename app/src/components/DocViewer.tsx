import { useState } from 'react';
import { API_BASE } from '../lib/apiBase';

interface DocViewerProps {
  title: string;
  content: string; // HTML 文档片段(角色约定:doc 产物 content 是 HTML,不是 Markdown)
}

// doc 产物 content 是 HTML 文档片段(writing 角色的 artifactHint 已约定模型直接输出
// HTML 而非 Markdown 源码),因此这里用 iframe 渲染而不是 MarkdownText——
// 避免把模型输出的 HTML 标签当纯文本转义显示。
export function DocViewer({ title, content }: DocViewerProps) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const exportDocx = async () => {
    setExporting(true);
    setExportError('');
    try {
      const res = await fetch(`${API_BASE}/workspace/export/docx`, {
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
      a.download = `${title}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="doc-viewer">
      <div className="doc-viewer-toolbar">
        <button type="button" className="doc-export-btn" onClick={exportDocx} disabled={exporting}>
          {exporting ? '导出中…' : '导出 Word'}
        </button>
      </div>
      {exportError && <div className="doc-export-error">{exportError}</div>}
      <iframe
        className="doc-viewer-iframe"
        srcDoc={content}
        sandbox="allow-scripts"
        title={title}
      />
    </div>
  );
}
