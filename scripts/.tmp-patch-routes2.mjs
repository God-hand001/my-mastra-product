import fs from 'node:fs';

const PATH = 'src/mastra/server/extension-routes.ts';
let s = fs.readFileSync(PATH, 'utf8');

// 扩展导入（若未扩展）
if (!s.includes('grantConnectorCapabilities')) {
  s = s.replace(
    /import \{\n  listExtensions,\n  listSkills,\n  toggle,\n  importSkill,\n  importConnector,\n\} from '\.\.\/services\/extension-store';/,
    `import {\n  listExtensions,\n  listSkills,\n  toggle,\n  importSkill,\n  importConnector,\n  listConnectors,\n  grantConnectorCapabilities,\n} from '../services/extension-store';`
  );
}

const authorizeRoute = `  // POST /extensions/connectors/:name/authorize：授予连接器声明的能力\n  registerApiRoute('/extensions/connectors/:name/authorize', {\n    method: 'POST',\n    handler: async c => {\n      const name = c.req.param('name');\n      const connector = listConnectors().find(cn => cn.name === name);\n      if (!connector) {\n        return c.json({ error: '未找到该连接器' }, 404);\n      }\n      const declared = connector.config.capabilities as { network?: boolean; externalWrite?: string[] } | undefined;\n      const declaredCaps: string[] = [];\n      if (declared?.network === true) declaredCaps.push('network');\n      if (Array.isArray(declared?.externalWrite) && declared.externalWrite.length > 0) {\n        declaredCaps.push('externalWrite');\n      }\n      if (declaredCaps.length === 0) {\n        return c.json({ error: '该连接器未声明任何需要授权的能力' }, 400);\n      }\n      let caps: string[];\n      try {\n        const body = await c.req.json<{ capabilities?: unknown }>();\n        if (body.capabilities === undefined) {\n          caps = declaredCaps;\n        } else if (!Array.isArray(body.capabilities)) {\n          return c.json({ error: 'capabilities 必须是字符串数组' }, 400);\n        } else {\n          caps = body.capabilities.map(x => {\n            if (x !== 'network' && x !== 'externalWrite') {\n              throw new Error(\`无法授予未声明的能力：\${x}\`);\n            }\n            if (!declaredCaps.includes(x)) {\n              throw new Error(\`无法授予未声明的能力：\${x}\`);\n            }\n            return x;\n          });\n          if (caps.length === 0) {\n            return c.json({ error: 'capabilities 不能为空数组' }, 400);\n          }\n        }\n      } catch (err) {\n        const reason = err instanceof Error ? err.message : String(err);\n        return c.json({ error: reason }, 400);\n      }\n      try {\n        grantConnectorCapabilities(name, caps);\n        await refresh();\n        return c.json({ ok: true, granted: caps });\n      } catch (err) {\n        const reason = err instanceof Error ? err.message : String(err);\n        return c.json({ error: \`授权失败：\${reason}\` }, 500);\n      }\n    },\n  }),\n`;

if (!s.includes('/extensions/connectors/:name/authorize')) {
  // 找到 toggle 路由结束后的位置插入
  const marker = `    },\n  }),\n\n  // POST /extensions/import`;
  s = s.replace(marker, authorizeRoute + '\n' + marker);
}

fs.writeFileSync(PATH, s, 'utf8');
console.log('updated extension-routes.ts');
