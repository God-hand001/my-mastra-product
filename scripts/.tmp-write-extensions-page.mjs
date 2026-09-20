import fs from 'node:fs';

const PATH = 'app/src/routes/ExtensionsPage.tsx';
let s = fs.readFileSync(PATH, 'utf8');

// 1. 导入 authorizeConnector
s = s.replace(
  /import \{\n  getSkillDetail,\n  importExtension,\n  listExtensions,\n  toggleExtension,\n  type ConnectorMeta,\n  type ExtensionsView,\n  type SkillMeta,\n\} from '\.\.\/lib\/extensionsClient';/,
  `import {\n  authorizeConnector,\n  getSkillDetail,\n  importExtension,\n  listExtensions,\n  toggleExtension,\n  type ConnectorMeta,\n  type ExtensionsView,\n  type SkillMeta,\n} from '../lib/extensionsClient';`
);

// 2. 替换开关按钮 onClick
const oldOnClick = `onClick={e => {\n                    // 阻断冒泡:点开关不触发卡片详情\n                    e.stopPropagation();\n                    void act(() => toggleExtension(tab, item.name));\n                  }}`;

const newOnClick = `onClick={async e => {\n                    // 阻断冒泡:点开关不触发卡片详情\n                    e.stopPropagation();\n                    // 连接器从禁用切到启用时,先检查并申请未授予能力\n                    if (tab === 'connector' && !item.enabled) {\n                      const connector = item as ConnectorMeta;\n                      const caps = connector.config.capabilities as { network?: boolean; externalWrite?: string[] } | undefined;\n                      const granted = new Set(connector.grantedCapabilities ?? []);\n                      const missing: string[] = [];\n                      if (caps?.network === true && !granted.has('network')) {\n                        missing.push('联网');\n                      }\n                      if (Array.isArray(caps?.externalWrite) && caps.externalWrite.length > 0 && !granted.has('externalWrite')) {\n                        missing.push('写外部目录');\n                      }\n                      if (missing.length > 0) {\n                        const ok = window.confirm(\`启用 \${connector.name} 需要授权以下能力：\${missing.join('、')}。是否允许？(批准后长期记住)\`);\n                        if (!ok) return;\n                        await act(() => authorizeConnector(connector.name).then(() => toggleExtension(tab, connector.name)));\n                        return;\n                      }\n                    }\n                    void act(() => toggleExtension(tab, item.name));\n                  }}`;

if (s.includes(oldOnClick)) {
  s = s.replace(oldOnClick, newOnClick);
} else {
  console.error('oldOnClick not found');
  process.exit(1);
}

fs.writeFileSync(PATH, s, 'utf8');
console.log('patched ExtensionsPage.tsx');
