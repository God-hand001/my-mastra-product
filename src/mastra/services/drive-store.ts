import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// 个人网盘核心服务(M2)
// F6 存储隔离:上传原件存 storage/drive/,与 agent 工作区(workspace)完全隔离
// F5 预算:单文件 ≤ 20MB;提取文本 ≤ 30 万字符,超限明确报错(N1/F5)
// N2 安全:扩展名白名单 + 文件名清洗,防路径穿越

const DRIVE_ROOT = path.resolve('storage/drive');
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 300_000;

const ALLOWED_EXTS = ['txt', 'md', 'csv', 'json', 'docx', 'pdf', 'xlsx'] as const;
type AllowedExt = (typeof ALLOWED_EXTS)[number];

export interface DriveFileMeta {
  id: string;
  name: string;
  size: number;
  ext: string;
  uploadedAt: string;
  textChars: number;
}

interface StoredMeta extends DriveFileMeta {
  text: string;
}

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function getMime(ext: string): string {
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

// 清洗用户文件名:去路径分隔符/控制字符/Windows 保留字符,限长,防空
export function sanitizeName(name: string): string {
  let cleaned = '';
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    // 跳过控制字符(0x00-0x1f)与 Windows 文件名非法字符
    if (code < 0x20) continue;
    if ('<>:"|?*'.includes(ch)) continue;
    cleaned += ch === '\\' || ch === '/' ? '_' : ch;
  }
  cleaned = cleaned.trim();
  if (!cleaned) return '未命名文件';
  return cleaned.length > 120 ? cleaned.slice(-120) : cleaned;
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function validateUpload(name: string, size: number): string | null {
  const ext = extOf(name);
  if (!ALLOWED_EXTS.includes(ext as AllowedExt)) {
    return `不支持的文件类型: .${ext || '(无扩展名)'}(支持 ${ALLOWED_EXTS.join(' / ')})`;
  }
  if (size > MAX_FILE_BYTES) {
    return '文件过大(超过 20MB 上限)';
  }
  if (size === 0) {
    return '空文件';
  }
  return null;
}

function fileDir(id: string): string {
  // id 由本服务生成(uuid),但下载/删除路由会接收外部输入,这里再校验一次防穿越
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('非法的文件 id');
  return path.join(DRIVE_ROOT, id);
}

function originalPath(id: string, ext: string): string {
  return path.join(fileDir(id), `original.${ext}`);
}

async function extractText(
  buffer: Buffer,
  ext: AllowedExt,
): Promise<{ text?: string; error?: string }> {
  try {
    if (ext === 'docx') {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      return { text: value };
    }
    if (ext === 'pdf') {
      // pdfjs-dist legacy 构建(Node 环境);pdf-parse@1.1.1 的 exports 禁止子路径引用,已弃用
      // 说明符运行时拼接:esbuild 在 Windows 上会把静态动态导入改写成反斜杠路径,导致 Node 报非法包名
      const pdfjsSpec = ['pdfjs-dist', 'legacy', 'build', 'pdf.mjs'].join('/');
      const pdfjs = (await import(
        /* @vite-ignore */ pdfjsSpec
      )) as typeof import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: false,
      }).promise;
      const pages: string[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const line = content.items
          .map(it => ('str' in it ? (it as { str: string }).str : ''))
          .join(' ');
        pages.push(line);
      }
      return { text: pages.join('\n\n') };
    }
    if (ext === 'xlsx') {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sections: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        sections.push(`## 工作表: ${sheetName}\n${csv}`);
      }
      return { text: sections.join('\n\n') };
    }
    // txt / md / csv / json 直读
    return { text: buffer.toString('utf-8') };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { error: `解析失败: ${reason}` };
  }
}

export async function saveFile(
  buffer: Buffer,
  originalName: string,
): Promise<{ meta?: DriveFileMeta; text?: string; error?: string }> {
  const name = sanitizeName(originalName);
  const ext = extOf(name);
  const invalid = validateUpload(name, buffer.length);
  if (invalid) return { error: invalid };
  if (!ALLOWED_EXTS.includes(ext as AllowedExt)) return { error: `不支持的文件类型: .${ext}` };

  const id = randomUUID();
  const dir = fileDir(id);
  await mkdir(dir, { recursive: true });
  await writeFile(originalPath(id, ext), buffer);

  const extracted = await extractText(buffer, ext as AllowedExt);
  if (extracted.error) {
    await rm(dir, { recursive: true, force: true });
    return { error: extracted.error };
  }
  const text = extracted.text ?? '';
  if (text.length > MAX_TEXT_CHARS) {
    await rm(dir, { recursive: true, force: true });
    return { error: `文件过大:提取文本 ${text.length} 字符,超过 30 万字符上限,暂不支持` };
  }

  const meta: StoredMeta = {
    id,
    name,
    size: buffer.length,
    ext,
    uploadedAt: new Date().toISOString(),
    textChars: text.length,
    text,
  };
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  const { text: _omit, ...publicMeta } = meta;
  return { meta: publicMeta, text };
}

export async function listFiles(): Promise<DriveFileMeta[]> {
  await mkdir(DRIVE_ROOT, { recursive: true });
  const ids = await readdir(DRIVE_ROOT);
  const metas: DriveFileMeta[] = [];
  for (const id of ids) {
    try {
      const raw = await readFile(path.join(DRIVE_ROOT, id, 'meta.json'), 'utf-8');
      const meta = JSON.parse(raw) as StoredMeta;
      const { text: _omit, ...publicMeta } = meta;
      metas.push(publicMeta);
    } catch {
      // 跳过损坏条目
    }
  }
  metas.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return metas;
}

export async function getFileText(
  id: string,
): Promise<{ name?: string; text?: string; error?: string }> {
  try {
    const raw = await readFile(path.join(fileDir(id), 'meta.json'), 'utf-8');
    const meta = JSON.parse(raw) as StoredMeta;
    return { name: meta.name, text: meta.text };
  } catch {
    return { error: '文件不存在或已删除' };
  }
}

// 下载原件:返回磁盘路径与保存名(路由负责流式响应)
export async function getOriginalFile(
  id: string,
): Promise<{ path?: string; name?: string; error?: string }> {
  try {
    const raw = await readFile(path.join(fileDir(id), 'meta.json'), 'utf-8');
    const meta = JSON.parse(raw) as StoredMeta;
    return { path: originalPath(meta.id, meta.ext), name: meta.name };
  } catch {
    return { error: '文件不存在或已删除' };
  }
}

export async function deleteFile(id: string): Promise<void> {
  await rm(fileDir(id), { recursive: true, force: true });
}
