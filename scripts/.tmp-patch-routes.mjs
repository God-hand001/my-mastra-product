import fs from 'node:fs';

const PATH = 'src/mastra/server/extension-routes.ts';
let s = fs.readFileSync(PATH, 'utf8');

// 1. 扩展导入
s = s.replace(
  /import \{\n  listExtensions,\n  listSkills,\n  toggle,\n  importSkill,\n  importConnector,\n\} from '\.\.\/services\/extension-store';/,
  `import {\n  listExtensions,\n  listSkills,\n  toggle,\n  importSkill,\n  importConnector,\n  listConnectors,\n  grantConnectorCapabilities,\n} from '../services/extension-store';`
);

// 2. 在 toggle 路由后插入 authorize 路由
const insertAfter = `  // POST /extensions/:kind/:name/toggle：切换启用/禁用\n  registerApiRoute('/extensions/:kind/:name/toggle', {\n    method: 'POST',\n    handler: async c => {\n      const kind = c.req.param('kind') as 'skill' | 'connector';\n      const name = c.req.param('name');\n      if (kind !== 'skill' && kind !== 'connector') {\n        return c.json({ error: 'kind 必须是 skill 或 connector' }, 400);\n      }\n      try {\n        toggle(kind, name);\n        if (kind === 'connector') {\n          await refresh();\n        }\n        return c.json({ ok: true });\n      } catch (err) {\n        const reason = err instanceof Error ? err.message : String(err);\n        return c.json({ error: \`切换失败：\${reason}\` }, 500);\n      }\n    },\n  }),\n`;

const authorizeRoute = `  // POST /extensions/connectors/:name/authorize：授予连接器声明的能力\n  registerApiRoute('/extensions/connectors/:name/authorize', {\n    method: 'POST',\n    handler: async c => {\n      const name = c.req.param('name');\n      const connector = listConnectors().find(cn => cn.name === name);\n      if (!connector) {\n        return c.json({ error: '未找到该连接器' }, 404);\n      }\n      const declared = connector.config.capabilities as { network?: boolean; externalWrite?: string[] } | undefined;\n      const declaredCaps: string[] = [];\n      if (declared?.network === true) declaredCaps.push('network');\n      if (Array.isArray(declared?.externalWrite) && declared.externalWrite.length > 0) {\n        declaredCaps.push('externalWrite');\n      }\n      if (declaredCaps.length === 0) {\n        return c.json({ error: '该连接器未声明任何需要授权的能力' }, 400);\n      }\n      let caps: string[];\n      try {\n        const body = await c.req.json<{ capabilities?: unknown }>();\n        if (body.capabilities === undefined) {\n          caps = declaredCaps;\n        } else if (!Array.isArray(body.capabilities)) {\n          return c.json({ error: 'capabilities 必须是字符串数组' }, 400);\n        } else {\n          caps = body.capabilities.map(x => {\n            if (x !== 'network' && x !== 'externalWrite') {\n              throw new Error(\`无法授予未声明的能力：\${x}\`);\n            }\n            if (!declaredCaps.includes(x)) {\n              throw new Error(\`无法授予未声明的能力：\${x}\`);\n            }\n            return x;\n          });\n          if (caps.length === 0) {\n            return c.json({ error: 'capabilities 不能为空数组' }, 400);\n          }\n        }\n      } catch (err) {\n        const reason = err instanceof Error ? err.message : String(err);\n        return c.json({ error: reason }, 400);\n      }\n      try {\n        grantConnectorCapabilities(name, caps);\n        await refresh();\n        return c.json({ ok: true, granted: caps });\n      } catch (err) {\n        const reason = err instanceof Error ? err.message : String(err);\n        return c.json({ error: \`授权失败：\${reason}\` }, 500);\n      }\n    },\n  }),\n`;

if (!s.includes('/extensions/connectors/:name/authorize')) {
  s = s.replace(insertAfter, insertAfter + authorizeRoute);
}

fs.writeFileSync(PATH, s, 'utf8');
console.log('updated extension-routes.ts');
