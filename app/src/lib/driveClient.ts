// 个人网盘 HTTP 客户端(M2)

export interface DriveFileMeta {
  id: string;
  name: string;
  size: number;
  ext: string;
  uploadedAt: string;
  textChars: number;
}

export interface UploadResult {
  meta?: DriveFileMeta;
  text?: string;
  error?: string;
}

const API = '/drive/files';

export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(API, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) return { error: data.error ?? `上传失败(${res.status})` };
  return data as UploadResult;
}

export async function listFiles(): Promise<DriveFileMeta[]> {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`加载网盘列表失败(${res.status})`);
  const data = await res.json();
  return data.files ?? [];
}

export async function getFileText(id: string): Promise<{ name?: string; text?: string; error?: string }> {
  const res = await fetch(`${API}/${id}/text`);
  return res.json();
}

export async function deleteFile(id: string): Promise<void> {
  const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`删除失败(${res.status})`);
}

export function downloadUrl(id: string): string {
  return `${API}/${id}/download`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 附件在 UI 中的形态(已确认可用的网盘文件)
export interface PickedAttachment {
  id: string;
  name: string;
  size: number;
  text: string;
}
