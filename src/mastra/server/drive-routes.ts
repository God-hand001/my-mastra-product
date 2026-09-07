import { registerApiRoute } from '@mastra/core/server';
import {
  deleteFile,
  getMime,
  getOriginalFile,
  getFileText,
  listFiles,
  saveFile,
} from '../services/drive-store';

// 个人网盘 HTTP 路由(M2,spec F1/F4)
// 仅本机可用(延续 M0 无鉴权形态,N2);所有逻辑在 drive-store,这里只做 HTTP 适配

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const driveRoutes = [
  registerApiRoute('/drive/files', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File)) {
          return c.json({ error: '缺少文件字段 file' }, 400);
        }
        if (file.size > MAX_FILE_BYTES) {
          return c.json({ error: '文件过大(超过 20MB 上限)' }, 400);
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await saveFile(buffer, file.name);
        if (result.error) {
          return c.json({ error: result.error }, 400);
        }
        return c.json({ ...result.meta, text: result.text });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `上传失败: ${reason}` }, 500);
      }
    },
  }),

  registerApiRoute('/drive/files', {
    method: 'GET',
    handler: async c => c.json({ files: await listFiles() }),
  }),

  registerApiRoute('/drive/files/:id/text', {
    method: 'GET',
    handler: async c => {
      const result = await getFileText(c.req.param('id'));
      if (result.error) return c.json({ error: result.error }, 404);
      return c.json(result);
    },
  }),

  registerApiRoute('/drive/files/:id/download', {
    method: 'GET',
    handler: async c => {
      const result = await getOriginalFile(c.req.param('id'));
      if (result.error || !result.path) return c.json({ error: result.error ?? '文件不存在' }, 404);
      const { createReadStream } = await import('node:fs');
      const stream = createReadStream(result.path);
      // 文件名含中文,按 RFC 5987 编码
      const encoded = encodeURIComponent(result.name ?? 'file');
      return new Response(stream as unknown as ReadableStream, {
        headers: {
          'Content-Type': getMime(result.name?.split('.').pop() ?? ''),
          'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
        },
      });
    },
  }),

  registerApiRoute('/drive/files/:id', {
    method: 'DELETE',
    handler: async c => {
      await deleteFile(c.req.param('id'));
      return c.json({ ok: true });
    },
  }),
];
