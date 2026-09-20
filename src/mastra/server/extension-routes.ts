import { registerApiRoute } from '@mastra/core/server';
import fs from 'node:fs';
import path from 'node:path';
import {
  listExtensions,
  listSkills,
  toggle,
  importSkill,
  importConnector,
  listConnectors,
  grantConnectorCapabilities,
} from '../services/extension-store';
import { refresh } from '../services/connector-runtime';

// 安全的本地导入路径校验：必须是绝对路径，且指向包含 SKILL.md 或 connector.json 的目录
function validateImportPath(localPath: string, kind: 'skill' | 'connector'): void {
  if (!path.isAbsolute(localPath)) {
    throw new Error('localPath 必须是绝对路径');
  }
  const required = kind === 'skill' ? 'SKILL.md' : 'connector.json';
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
    throw new Error('导入路径不是有效目录');
  }
  if (!fs.existsSync(path.join(localPath, required))) {
    throw new Error(`目录缺少 ${required}，无法导入${kind === 'skill' ? '技能' : '连接器'}`);
  }
}

export const extensionRoutes = [
  // GET /extensions：列出所有技能与连接器及其状态
  registerApiRoute('/extensions', {
    method: 'GET',
    handler: async c =>
      c.json({
        ...listExtensions(),
        __debug: { cwd: process.cwd(), extExists: fs.existsSync(path.resolve('extensions', 'skills')) },
      }),
  }),

  // GET /extensions/skills/:name：返回 SKILL.md 原文与路径
  registerApiRoute('/extensions/skills/:name', {
    method: 'GET',
    handler: async c => {
      const name = c.req.param('name');
      const skill = listSkills().find(s => s.name === name);
      if (!skill) {
        return c.json({ error: '未找到该技能' }, 404);
      }
      const skillPath = path.join(skill.dir, 'SKILL.md');
      try {
        const content = fs.readFileSync(skillPath, 'utf8');
        return c.json({ name, description: skill.description, dir: skill.dir, content });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `读取 SKILL.md 失败：${reason}` }, 500);
      }
    },
  }),

  // POST /extensions/:kind/:name/toggle：切换启用/禁用
  registerApiRoute('/extensions/:kind/:name/toggle', {
    method: 'POST',
    handler: async c => {
      const kind = c.req.param('kind') as 'skill' | 'connector';
      const name = c.req.param('name');
      if (kind !== 'skill' && kind !== 'connector') {
        return c.json({ error: 'kind 必须是 skill 或 connector' }, 400);
      }
      try {
        toggle(kind, name);
        if (kind === 'connector') {
          await refresh();
        }
        return c.json({ ok: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `切换失败：${reason}` }, 500);
      }
    },
  }),

  // POST /extensions/connectors/:name/authorize：授予连接器声明的能力
  registerApiRoute('/extensions/connectors/:name/authorize', {
    method: 'POST',
    handler: async c => {
      const name = c.req.param('name');
      const connector = listConnectors().find(cn => cn.name === name);
      if (!connector) {
        return c.json({ error: '未找到该连接器' }, 404);
      }
      const declared = connector.config.capabilities as { network?: boolean; externalWrite?: string[] } | undefined;
      const declaredCaps: string[] = [];
      if (declared?.network === true) declaredCaps.push('network');
      if (Array.isArray(declared?.externalWrite) && declared.externalWrite.length > 0) {
        declaredCaps.push('externalWrite');
      }
      if (declaredCaps.length === 0) {
        return c.json({ error: '该连接器未声明任何需要授权的能力' }, 400);
      }
      let caps: string[];
      try {
        const body = await c.req.json<{ capabilities?: unknown }>();
        if (body.capabilities === undefined) {
          caps = declaredCaps;
        } else if (!Array.isArray(body.capabilities)) {
          return c.json({ error: 'capabilities 必须是字符串数组' }, 400);
        } else {
          caps = body.capabilities.map(x => {
            if (x !== 'network' && x !== 'externalWrite') {
              throw new Error(`无法授予未声明的能力：${x}`);
            }
            if (!declaredCaps.includes(x)) {
              throw new Error(`无法授予未声明的能力：${x}`);
            }
            return x;
          });
          if (caps.length === 0) {
            return c.json({ error: 'capabilities 不能为空数组' }, 400);
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: reason }, 400);
      }
      try {
        grantConnectorCapabilities(name, caps);
        await refresh();
        return c.json({ ok: true, granted: caps });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `授权失败：${reason}` }, 500);
      }
    },
  }),

  // POST /extensions/import：导入本地扩展
  registerApiRoute('/extensions/import', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await c.req.json<{ localPath?: unknown; kind?: unknown }>();
        const localPath = typeof body.localPath === 'string' ? body.localPath : '';
        const kind = body.kind === 'connector' ? 'connector' : 'skill';
        if (!localPath) {
          return c.json({ error: '缺少 localPath 参数' }, 400);
        }
        validateImportPath(localPath, kind);
        if (kind === 'connector') {
          importConnector(localPath);
          await refresh();
        } else {
          importSkill(localPath);
        }
        return c.json({ ok: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: reason }, 400);
      }
    },
  }),
];
