import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteFile,
  downloadUrl,
  formatSize,
  listFiles,
  uploadFile,
  type DriveFileMeta,
} from '../lib/driveClient';

// 个人网盘页(M2 F4):列表 / 上传 / 删除 / 下载
export function DrivePage() {
  const [files, setFiles] = useState<DriveFileMeta[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listFiles()
      .then(setFiles)
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const res = await uploadFile(f);
        if (res.error) {
          setError(res.error);
          break;
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      refresh();
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFile(id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="drive-page">
      <div className="drive-header">
        <h2 className="drive-title">个人网盘</h2>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.csv,.json,.docx,.pdf,.xlsx"
          style={{ display: 'none' }}
          onChange={e => void handleUpload(e.target.files)}
        />
        <button
          className="drive-upload-btn"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? '上传解析中…' : '+ 上传文件'}
        </button>
      </div>

      {error && <div className="drive-error">{error}</div>}

      {files === null ? (
        <div className="drive-empty">加载中…</div>
      ) : files.length === 0 ? (
        <div className="drive-empty">网盘还是空的,上传一个文件试试</div>
      ) : (
        <div className="drive-list">
          {files.map(f => (
            <div key={f.id} className="drive-item">
              <div className="drive-item-main">
                <div className="drive-item-name">📎 {f.name}</div>
                <div className="drive-item-meta">
                  {formatSize(f.size)} · {new Date(f.uploadedAt).toLocaleString('zh-CN')} · 提取{' '}
                  {f.textChars} 字符
                </div>
              </div>
              <div className="drive-item-actions">
                <a className="drive-item-btn" href={downloadUrl(f.id)}>
                  下载
                </a>
                <button className="drive-item-btn drive-item-delete" onClick={() => void handleDelete(f.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
