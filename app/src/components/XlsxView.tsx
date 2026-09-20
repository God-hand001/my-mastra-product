import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { API_BASE } from '../lib/apiBase';
import type { FilePayload } from './PreviewPanel';
import '../styles/preview-xlsx.css';

// M9 视觉增强:xlsx/xls 用 SheetJS 在前端直接解析渲染(替换旧"转网页"路径)。
// 支持:多 sheet 标签页、表头冻结、斑马纹、按内容自适应列宽、数值显示单元格格式化文本。

// 渲染上限:超出部分提示"仅显示前 N 行/列",避免大表把 DOM 撑爆
const MAX_ROWS = 500;
const MAX_COLS = 60;
// 列宽估算:按内容字符数(中文字符按 2 计),夹在 [6, 42] 个半角字符宽
const MIN_COL_CH = 6;
const MAX_COL_CH = 42;

function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0xff ? 2 : 1;
  }
  return w;
}

export function XlsxView({ payload }: { payload: FilePayload }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const url =
      payload.source === 'workspace'
        ? `${API_BASE}/workspace/files/raw?path=${encodeURIComponent(payload.path ?? '')}`
        : `${API_BASE}/drive/files/${payload.fileId ?? ''}/download`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`加载失败: ${res.status}`);
      const data = await res.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      if (wb.SheetNames.length === 0) throw new Error('文件里没有工作表');
      setWorkbook(wb);
      setActiveSheet(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [payload]);

  useEffect(() => {
    void load();
  }, [load, retryKey]);

  const sheetName = workbook?.SheetNames[activeSheet];
  const grid = useMemo(() => {
    if (!workbook || !sheetName) return null;
    const ws = workbook.Sheets[sheetName];
    // raw:false → 用单元格格式化后的文本(保留千分位/百分比/日期格式)
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
    return rows as string[][];
  }, [workbook, sheetName]);

  const colCount = useMemo(() => {
    if (!grid) return 0;
    let max = 0;
    for (const row of grid.slice(0, 50)) {
      max = Math.max(max, row?.length ?? 0);
    }
    return Math.min(max, MAX_COLS);
  }, [grid]);

  const colWidths = useMemo(() => {
    if (!grid || colCount === 0) return [];
    const widths = new Array<number>(colCount).fill(MIN_COL_CH);
    for (const row of grid.slice(0, 100)) {
      for (let c = 0; c < colCount; c++) {
        widths[c] = Math.max(widths[c], Math.min(displayWidth(String(row?.[c] ?? '')), MAX_COL_CH));
      }
    }
    return widths;
  }, [grid, colCount]);

  return (
    <div className="xlsx-view">
      {loading && <div className="preview-spinner" aria-label="表格加载中" />}
      {!loading && error && (
        <div className="preview-state">
          <p>{error}</p>
          <button type="button" className="preview-retry" onClick={() => setRetryKey(k => k + 1)}>
            重试
          </button>
        </div>
      )}
      {!loading && !error && workbook && (
        <>
          {workbook.SheetNames.length > 1 && (
            <div className="xlsx-sheet-tabs" role="tablist">
              {workbook.SheetNames.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={i === activeSheet}
                  className={`xlsx-sheet-tab${i === activeSheet ? ' is-active' : ''}`}
                  onClick={() => setActiveSheet(i)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {grid && grid.length === 0 ? (
            <div className="preview-state">
              <p>这个工作表是空的</p>
            </div>
          ) : (
            <div className="xlsx-table-wrap">
              <table className="xlsx-table">
                <colgroup>
                  {colWidths.map((w, i) => (
                    <col key={i} style={{ width: `${w}ch` }} />
                  ))}
                </colgroup>
                <tbody>
                  {(grid ?? []).slice(0, MAX_ROWS).map((row, r) => (
                    <tr key={r} className={r === 0 ? 'xlsx-head-row' : r % 2 === 0 ? 'xlsx-zebra' : ''}>
                      {Array.from({ length: colCount }, (_, c) => (
                        <td key={c} className={r === 0 ? 'xlsx-head-cell' : ''}>
                          {String(row?.[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {(grid?.length ?? 0) > MAX_ROWS && (
                <div className="xlsx-truncated">数据较大,仅显示前 {MAX_ROWS} 行</div>
              )}
              {colCount >= MAX_COLS && <div className="xlsx-truncated">列数较多,仅显示前 {MAX_COLS} 列</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
