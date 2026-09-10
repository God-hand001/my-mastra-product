import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectDir } from '../services/project-store';

// 项目文件工具(H0,读写版)
// 激活条件:requestContext.projectDir 指向已注册项目的目录(N1)
// 未激活/未注册时返回提示文本,不执行任何 fs 操作
const MAX_TEXT_CHARS = 300_000;

interface ProjectCtxResult {
  dir?: string;
  error?: string;
}

async function activeProjectDir(context: {
  requestContext?: { get?: (key: string) => unknown };
}): Promise<ProjectCtxResult> {
  const raw = context?.requestContext?.get?.('projectDir');
  if (typeof raw !== 'string' || !raw) {
    return { error: '未选择项目:请先在首页选择项目后再使用项目文件功能' };
  }
  const registered = await resolveProjectDir(raw);
  if (!registered) {
    return { error: `项目目录未注册,拒绝访问: ${raw}` };
  }
  return { dir: registered };
}

// 相对路径 → 项目目录内的绝对路径;防穿越(N1)
function safeJoin(dir: string, relativePath: string): string | null {
  const cleaned = relativePath.replace(/^[a-zA-Z]:[\\/]/, '').replace(/^[\\/]+/, '');
  const resolved = path.resolve(dir, cleaned);
  const dirNorm = path.resolve(dir).toLowerCase();
  if (!resolved.toLowerCase().startsWith(dirNorm + path.sep) && resolved.toLowerCase() !== dirNorm) {
    return null;
  }
  return resolved;
}

export const projectListFilesTool = createTool({
  id: 'project_list_files',
  description:
    'List files and folders in the current project directory (one level). Requires a project to be selected.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    entries: z.array(z.object({ name: z.string(), type: z.string() })),
    error: z.string().optional(),
  }),
  execute: async (_input, context) => {
    const { dir, error } = await activeProjectDir(context);
    if (error || !dir) return { entries: [], error };
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return {
        entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { entries: [], error: `读取目录失败: ${reason}` };
    }
  },
});

export const projectReadFileTool = createTool({
  id: 'project_read_file',
  description:
    'Read a text file from the current project directory by relative path. Requires a project to be selected.',
  inputSchema: z.object({
    filePath: z.string().min(1).describe('相对项目目录的文件路径,如 src/index.js'),
  }),
  outputSchema: z.object({
    path: z.string().optional(),
    content: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ filePath }, context) => {
    const { dir, error } = await activeProjectDir(context);
    if (error || !dir) return { error };
    const abs = safeJoin(dir, filePath);
    if (!abs) return { error: `非法路径: ${filePath}` };
    try {
      const buf = await readFile(abs);
      const text = buf.toString('utf-8');
      return {
        path: filePath,
        content: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…(过长已截断)` : text,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { error: `读取失败: ${reason}` };
    }
  },
});

export const projectWriteFileTool = createTool({
  id: 'project_write_file',
  description:
    'Create or overwrite a text file inside the current project directory (relative path, parent dirs auto-created). Requires a project to be selected.',
  inputSchema: z.object({
    filePath: z.string().min(1).describe('相对项目目录的文件路径,如 src/index.js'),
    content: z.string().describe('要写入的完整文本内容'),
  }),
  outputSchema: z.object({
    path: z.string().optional(),
    bytes: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ filePath, content }, context) => {
    const { dir, error } = await activeProjectDir(context);
    if (error || !dir) return { error };
    const abs = safeJoin(dir, filePath);
    if (!abs) return { error: `非法路径: ${filePath}` };
    try {
      await mkdir(path.dirname(abs), { recursive: true });
      const buf = Buffer.from(content, 'utf-8');
      if (buf.length > MAX_TEXT_CHARS) {
        return { error: `内容过大(${buf.length} 字节),超过 30 万字符上限` };
      }
      await writeFile(abs, buf);
      return { path: filePath, bytes: buf.length };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { error: `写入失败: ${reason}` };
    }
  },
});
