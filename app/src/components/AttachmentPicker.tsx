import { useEffect, useRef, useState } from 'react';
import { formatSize, listFiles, uploadFile, getFileText, type DriveFileMeta } from '../lib/driveClient';
import { API_BASE } from '../lib/apiBase';

// 附件选择弹层(M2 F1 + H0 工作空间):三个页签
// 「上传新文件」「从网盘选择」「工作空间」
// onPick 返回 false 表示父组件判定已达上限,选择器停止继续添加
interface Attachment {
  id: string;
  name: string;
  size: number;
  text: string;
}

interface WorkspaceEntry {
  path: string;
  name: string;
  type: string;
}

export function AttachmentPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (a: Attachment) => boolean;
}) {
  const [tab, setTab] = useState<'upload' | 'drive' | 'workspace'>('upload');
  const [driveFiles, setDriveFiles] = useState<DriveFileMeta[] | null>(null);
  const [wsFiles, setWsFiles] = useState<WorkspaceEntry[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tab === 'drive' && driveFiles === null) {
      listFiles()
        .then(setDriveFiles)
        .catch(e => setError(String(e)));
    }
    if (tab === 'workspace' && wsFiles === null) {
      fetch(`${API_BASE}/workspace/files?path=/`)
        .then(res => res.json())
        .then(data => setWsFiles(data.entries ?? []))
        .catch(e => setError(String(e)));
    }
  }, [tab, driveFiles, wsFiles]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        let res;
        try {
          res = await uploadFile(f);
        } catch (e) {
          setError(`上传出错: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        if (res.error || !res.meta || res.text === undefined) {
          setError(res.error ?? '上传失败');
          break;
        }
        const accepted = onPick({
          id: res.meta.id,
          name: res.meta.name,
          size: res.meta.size,
          text: res.text,
        });
        if (!accepted) {
          setError('附件已达上限(5 个)');
          break;
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const pickFromDrive = async (meta: DriveFileMeta) => {
    setError('');
    const res = await getFileText(meta.id);
    if (res.error || res.text === undefined) {
      setError(res.error ?? '读取文件失败');
      return;
    }
    const accepted = onPick({ id: meta.id, name: meta.name, size: meta.size, text: res.text });
    if (!accepted) setError('附件已达上限(5 个)');
  };

  const pickFromWorkspace = async (entry: WorkspaceEntry) => {
    setError('');
    try {
      const res = await fetch(
        `${API_BASE}/workspace/files/content?path=${encodeURIComponent(entry.path)}`,
      );
      const data = await res.json();
      if (data.error || data.content === undefined) {
        setError(data.error ?? '读取文件失败');
        return;
      }
      const accepted = onPick({
        id: `ws:${entry.path}`,
        name: entry.name,
        size: data.content.length,
        text: data.content,
      });
      if (!accepted) setError('附件已达上限(5 个)');
    } catch (e) {
      setError(`读取出错: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="picker-mask" onClick={onClose}>
      <div className="picker-panel" onClick={e => e.stopPropagation()}>
        <div className="picker-tabs">
          <button
            className={tab === 'upload' ? 'is-active' : ''}
            onClick={() => setTab('upload')}
          >
            上传新文件
          </button>
          <button
            className={tab === 'drive' ? 'is-active' : ''}
            onClick={() => setTab('drive')}
          >
            从网盘选择
          </button>
          <button
            className={tab === 'workspace' ? 'is-active' : ''}
            onClick={() => setTab('workspace')}
          >
            工作空间
          </button>
          <button className="picker-close" onClick={onClose}>
            ×
          </button>
        </div>

        {tab === 'upload' && (
          <div className="picker-upload">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.csv,.json,.docx,.pdf,.xlsx"
              style={{ display: 'none' }}
              onChange={e => void handleFiles(e.target.files)}
            />
            <button
              className="picker-upload-btn"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? '上传并解析中…' : '选择文件(txt/md/csv/json/docx/pdf/xlsx)'}
            </button>
          </div>
        )}

        {tab === 'drive' && (
          <div className="picker-drive-list">
            {driveFiles === null ? (
              <div className="picker-tip">加载中…</div>
            ) : driveFiles.length === 0 ? (
              <div className="picker-tip">网盘还是空的</div>
            ) : (
              driveFiles.map(f => (
                <div
                  key={f.id}
                  className="picker-drive-item"
                  onClick={() => void pickFromDrive(f)}
                >
                  <span className="picker-drive-name">{f.name}</span>
                  <span className="picker-drive-meta">{formatSize(f.size)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'workspace' && (
          <div className="picker-drive-list">
            {wsFiles === null ? (
              <div className="picker-tip">加载中…</div>
            ) : wsFiles.length === 0 ? (
              <div className="picker-tip">工作空间还是空的</div>
            ) : (
              wsFiles.map(f => (
                <div
                  key={f.path}
                  className="picker-drive-item"
                  onClick={() =>
                    f.type === 'file' ? void pickFromWorkspace(f) : undefined
                  }
                  style={{ cursor: f.type === 'file' ? 'pointer' : 'default' }}
                >
                  <span className="picker-drive-name">
                    {f.type === 'dir' ? '📁 ' : ''}
                    {f.name}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {error && <div className="picker-error">{error}</div>}
      </div>
    </div>
  );
}
