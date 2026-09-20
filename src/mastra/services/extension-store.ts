import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectRoot } from './project-root';

// 内置扩展、本地导入扩展、注册表路径（项目根用统一解析器,见 project-root.ts）
const EXT_DIR = path.join(resolveProjectRoot(), 'extensions');
const LOCAL_EXT_DIR = path.join(resolveProjectRoot(), 'extensions-local');
const REGISTRY_PATH = path.join(resolveProjectRoot(), 'storage', 'extensions-registry.json');

export type SkillSource = 'builtin' | 'local';

export type ConnectorCapability = 'network' | 'externalWrite';

// ── 内置中文元数据(D3,2026-09-17):技能/连接器的中文名、描述、图标、分类 ──
// 展示层用;SKILL.md frontmatter 的 name_zh/description_zh/icon/category 优先于本表。
export interface ExtensionDisplay {
  nameZh?: string;
  descZh?: string;
  icon?: string;
  category?: string;
}

const SKILL_DISPLAY: Record<string, ExtensionDisplay> = {
  'academy-guide': { nameZh: 'Claude 使用指南', descZh: '回答 Claude 产品使用问题前先行自检,确保指引准确', icon: '📖', category: '效率工具' },
  'algorithmic-art': { nameZh: '算法艺术', descZh: '用 p5.js 以种子随机生成可交互的算法艺术作品', icon: '🎨', category: '视觉创意' },
  'brand-guidelines': { nameZh: '品牌规范', descZh: '将官方品牌色与排版规范应用到各类产物上', icon: '🎯', category: '视觉创意' },
  'canvas-design': { nameZh: '视觉设计', descZh: '以设计方法论创作 .png 与 .pdf 视觉作品', icon: '🎨', category: '视觉创意' },
  'claude-api': { nameZh: 'Claude API 参考', descZh: 'Claude API / Anthropic SDK 参考:模型、定价、流式、工具与 MCP', icon: '🔌', category: '产品开发' },
  'discernment-nudge': { nameZh: '审慎建议', descZh: '在给出可执行的建议或成稿后,补充审慎性提醒', icon: '💡', category: '效率工具' },
  'doc-coauthoring': { nameZh: '文档共写', descZh: '以结构化流程与用户协作撰写文档', icon: '📝', category: '内容创作' },
  'docx': { nameZh: 'Word 文档', descZh: '按规范生成 .docx 文档,支持目录、页眉页脚、表格与样式', icon: '📄', category: '内容创作' },
  'eda-basics': { nameZh: 'EDA 基础', descZh: '电子设计自动化基础知识与嘉立创 EDA 使用指引', icon: '⚡', category: '产品开发' },
  'excel-generation': { nameZh: 'Excel 生成', descZh: '按规范生成含公式、样式与多表结构的 Excel 文件', icon: '📊', category: '内容创作' },
  'frontend-design': { nameZh: '前端设计', descZh: '生成有设计品质的前端界面,避免千篇一律的 AI 风格', icon: '🖥️', category: '产品开发' },
  'internal-comms': { nameZh: '内部沟通', descZh: '起草状态报告、更新说明与内部沟通文稿', icon: '📢', category: '效率工具' },
  'jlc-order-guide': { nameZh: '嘉立创下单指南', descZh: '嘉立创平台下单流程、工艺选择与注意事项指引', icon: '🛒', category: '电商零售' },
  'mcp-builder': { nameZh: 'MCP 构建器', descZh: '指导构建高质量的 MCP(Model Context Protocol)服务器', icon: '🔧', category: '产品开发' },
  'pdf': { nameZh: 'PDF 处理', descZh: 'PDF 的读取、生成、拆分合并与表单处理', icon: '📕', category: '内容创作' },
  'pptx': { nameZh: '演示文稿', descZh: '生成结构清晰、排版专业的 .pptx 演示文稿', icon: '📊', category: '内容创作' },
  'skill-creator': { nameZh: '技能创建', descZh: '引导创建结构规范的新技能', icon: '✨', category: '产品开发' },
  'slack-gif-creator': { nameZh: 'Slack GIF 制作', descZh: '为 Slack 制作简单有趣的 GIF 动图', icon: '🎞️', category: '效率工具' },
  'theme-factory': { nameZh: '主题工厂', descZh: '生成并套用主题样式包(配色、字体、组件风格)', icon: '🖌️', category: '视觉创意' },
  'web-artifacts-builder': { nameZh: '网页构建', descZh: '构建复杂、精致的单页网页制品(HTML/JS/CSS)', icon: '🌐', category: '产品开发' },
  'webapp-testing': { nameZh: 'Web 应用测试', descZh: '用 Playwright 对本地 Web 应用做真实交互测试', icon: '🧪', category: '产品开发' },
  'word-html-spec': { nameZh: 'Word HTML 规范', descZh: '嘉立创定制的 Word 生成 HTML 规范(章节、目录、页眉页脚)', icon: '📝', category: '内容创作' },
  'xlsx': { nameZh: '表格处理', descZh: '创建、分析与处理 Excel 表格数据', icon: '📈', category: '内容创作' },
};

const CONNECTOR_DISPLAY: Record<string, ExtensionDisplay> = {
  'everything': { nameZh: 'MCP 演示服务器', descZh: 'MCP 协议能力演示,包含多种测试工具', icon: '🧰', category: '产品开发' },
  'fetch': { nameZh: '网页抓取', descZh: '抓取网页内容并转为 Markdown,供阅读与分析', icon: '🌐', category: '效率工具' },
  'filesystem': { nameZh: '文件系统', descZh: '在指定目录内进行文件读写与检索', icon: '📁', category: '效率工具' },
  'git': { nameZh: '版本管理', descZh: '查询仓库状态、提交历史与分支信息', icon: '🌿', category: '产品开发' },
  'memory': { nameZh: '知识图谱记忆', descZh: '基于知识图谱的跨会话长期记忆存取', icon: '🧠', category: '效率工具' },
  'sequential-thinking': { nameZh: '序贯思考', descZh: '分步骤的动态推理与反思式问题求解', icon: '🤔', category: '咨询研究' },
  'sqlite': { nameZh: '数据库查询', descZh: '对 SQLite 数据库执行查询与分析', icon: '🗄️', category: '数据分析' },
  'time': { nameZh: '时间查询', descZh: '查询各时区的当前时间与换算', icon: '🕐', category: '效率工具' },
};

/** 合并展示元数据:frontmatter 中文字段优先,内置表兜底 */
function mergeDisplay(
  name: string,
  front: Record<string, string>,
  table: Record<string, ExtensionDisplay>,
): ExtensionDisplay {
  const builtin = table[name] ?? {};
  const pick = (frontKey: string, metaKey: 'nameZh' | 'descZh' | 'icon' | 'category'): string | undefined => {
    const v = front[frontKey]?.trim();
    return v ? v : builtin[metaKey];
  };
  return {
    nameZh: pick('name_zh', 'nameZh'),
    descZh: pick('description_zh', 'descZh'),
    icon: pick('icon', 'icon'),
    category: pick('category', 'category'),
  };
}

export interface SkillMeta {
  name: string;
  description: string;
  source: SkillSource;
  enabled: boolean;
  dir: string;
  nameZh?: string;
  descZh?: string;
  icon?: string;
  category?: string;
}

export interface ConnectorMeta {
  name: string;
  description: string;
  config: Record<string, unknown>;
  source: SkillSource;
  enabled: boolean;
  lastError: string | null;
  invalid: boolean;
  grantedCapabilities?: string[];
  nameZh?: string;
  descZh?: string;
  icon?: string;
  category?: string;
}

interface Registry {
  skills: Record<string, boolean>;
  connectors: Record<string, { enabled: boolean; lastError: string | null; grantedCapabilities?: string[] }>;
}

// 内存缓存，避免同一进程内反复读盘
let registryCache: Registry | null = null;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadRegistry(): Registry {
  if (registryCache) return registryCache;
  ensureDir(path.dirname(REGISTRY_PATH));
  if (!fs.existsSync(REGISTRY_PATH)) {
    registryCache = { skills: {}, connectors: {} };
    saveRegistry();
    return registryCache;
  }
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Registry>;
    registryCache = {
      skills: parsed.skills ?? {},
      connectors: parsed.connectors ?? {},
    };
  } catch {
    // 注册表损坏时回退到空表，避免启动失败
    registryCache = { skills: {}, connectors: {} };
  }
  return registryCache;
}

function saveRegistry(): void {
  ensureDir(path.dirname(REGISTRY_PATH));
  fs.writeFileSync(
    REGISTRY_PATH,
    JSON.stringify(registryCache ?? { skills: {}, connectors: {} }, null, 2),
    'utf-8'
  );
}

/**
 * 简易 YAML frontmatter 解析：单行 key: value + 多行块标量(description: >- / |)。
 * 值外层有引号则去掉引号，Mastra 后续会用自己的解析器读取完整 frontmatter。
 */
function parseFrontmatter(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) return result;
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) return result;
  const lines = trimmed.slice(3, end).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // 块标量(>/| 及 +/- 修饰符):收集后续缩进行;> 折叠为空格,| 保留换行
    if (/^[>|][+-]?\d*$/.test(value)) {
      const parts: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const cont = lines[j];
        if (!cont.trim()) {
          parts.push('');
          continue;
        }
        if (/^\s/.test(cont)) {
          parts.push(cont.trim());
          continue;
        }
        break;
      }
      i = j - 1;
      result[key] = (value.startsWith('>') ? parts.filter(Boolean).join(' ') : parts.join('\n')).trim();
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function listSkillDirectories(): Array<{ dir: string; source: SkillSource }> {
  const out: Array<{ dir: string; source: SkillSource }> = [];
  const builtin = path.join(EXT_DIR, 'skills');
  const local = path.join(LOCAL_EXT_DIR, 'skills');
  // 先内置后本地;同名理论不该出现(importSkill 拒绝重名),取先见者
  for (const [base, source] of [
    [builtin, 'builtin'],
    [local, 'local'],
  ] as const) {
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'SKILL.md'))) {
        out.push({ dir, source });
      }
    }
  }
  return out;
}

function listConnectorDirectories(): Array<{ dir: string; source: SkillSource }> {
  const out: Array<{ dir: string; source: SkillSource }> = [];
  const builtin = path.join(EXT_DIR, 'connectors');
  const local = path.join(LOCAL_EXT_DIR, 'connectors');
  for (const [base, source] of [
    [builtin, 'builtin'],
    [local, 'local'],
  ] as const) {
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'connector.json'))) {
        out.push({ dir, source });
      }
    }
  }
  return out;
}

function readSkillMeta(dir: string): SkillMeta & { invalid: boolean; frontmatter: Record<string, string> } {
  const file = path.join(dir, 'SKILL.md');
  const raw = fs.readFileSync(file, 'utf-8');
  const fm = parseFrontmatter(raw);
  return {
    name: fm.name || path.basename(dir),
    description: fm.description || '',
    source: dir.startsWith(LOCAL_EXT_DIR) ? 'local' : 'builtin',
    enabled: true,
    dir,
    invalid: false,
    frontmatter: fm,
  };
}

function readConnectorMeta(dir: string): ConnectorMeta & { invalid: boolean } {
  const file = path.join(dir, 'connector.json');
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: (config.name as string) || path.basename(dir),
      description: (config.description as string) || '',
      config,
      source: dir.startsWith(LOCAL_EXT_DIR) ? 'local' : 'builtin',
      enabled: true,
      lastError: null,
      invalid: false,
      grantedCapabilities: undefined,
    };
  } catch {
    return {
      name: path.basename(dir),
      description: '',
      config: {},
      source: dir.startsWith(LOCAL_EXT_DIR) ? 'local' : 'builtin',
      enabled: true,
      lastError: null,
      invalid: true,
      grantedCapabilities: undefined,
    };
  }
}

/** 列出所有已发现技能 */
export function listSkills(): SkillMeta[] {
  const registry = loadRegistry();
  const items = listSkillDirectories();
  const seen = new Set<string>();
  const result: SkillMeta[] = [];
  for (const { dir, source } of items) {
    const meta = readSkillMeta(dir);
    if (seen.has(meta.name)) continue;
    seen.add(meta.name);
    const display = mergeDisplay(meta.name, meta.frontmatter, SKILL_DISPLAY);
    result.push({
      name: meta.name,
      description: meta.description,
      source,
      enabled: registry.skills[meta.name] !== false,
      dir,
      ...display,
    });
  }
  return result;
}

/** 列出所有已发现连接器（含启用状态与上次错误） */
export function listConnectors(): ConnectorMeta[] {
  const registry = loadRegistry();
  const items = listConnectorDirectories();
  const seen = new Set<string>();
  const result: ConnectorMeta[] = [];
  for (const { dir, source } of items) {
    const meta = readConnectorMeta(dir);
    if (seen.has(meta.name)) continue;
    seen.add(meta.name);
    const state = registry.connectors[meta.name];
    // 连接器中文字段:connector.json 里可直接写 name_zh/description_zh/icon/category
    const front: Record<string, string> = {};
    for (const k of ['name_zh', 'description_zh', 'icon', 'category']) {
      if (typeof meta.config[k] === 'string') front[k] = meta.config[k] as string;
    }
    const display = mergeDisplay(meta.name, front, CONNECTOR_DISPLAY);
    result.push({
      name: meta.name,
      description: meta.description,
      config: meta.config,
      source,
      enabled: state?.enabled !== false,
      lastError: state?.lastError ?? null,
      invalid: meta.invalid,
      grantedCapabilities: state?.grantedCapabilities,
      ...display,
    });
  }
  return result;
}

/** 统一列出技能与连接器，供 REST / 面板使用 */
export function listExtensions(): { skills: SkillMeta[]; connectors: ConnectorMeta[] } {
  return { skills: listSkills(), connectors: listConnectors() };
}

/**
 * 设置连接器最近一次错误信息，供 connector-runtime 在启动失败后写入。
 * 传入 null 表示清空错误。
 */
export function setConnectorError(name: string, error: Error | string | null): void {
  const registry = loadRegistry();
  const state = registry.connectors[name] ?? { enabled: true, lastError: null };
  if (error === null) {
    state.lastError = null;
  } else if (error instanceof Error) {
    state.lastError = error.message;
  } else {
    state.lastError = error;
  }
  registry.connectors[name] = state;
  saveRegistry();
}

/** 持久化授予连接器的能力键数组 */
export function grantConnectorCapabilities(name: string, caps: string[]): void {
  const registry = loadRegistry();
  const state = registry.connectors[name];
  if (!state) {
    throw new Error(`未找到连接器：${name}`);
  }
  state.grantedCapabilities = caps;
  registry.connectors[name] = state;
  saveRegistry();
}

/** 切换启用/禁用状态 */
export function toggle(kind: 'skill' | 'connector', name: string): void {
  const registry = loadRegistry();
  if (kind === 'skill') {
    const current = registry.skills[name] !== false;
    registry.skills[name] = !current;
  } else {
    const state = registry.connectors[name] ?? { enabled: true, lastError: null };
    state.enabled = !state.enabled;
    registry.connectors[name] = state;
  }
  saveRegistry();
}

/** 把本地目录导入为技能 */
export function importSkill(sourceDir: string): void {
  if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
    throw new Error('目录缺少 SKILL.md，无法导入技能');
  }
  const meta = readSkillMeta(sourceDir);
  const existing = listSkills().find(s => s.name === meta.name);
  if (existing) {
    throw new Error(`技能名称冲突：${meta.name} 已存在`);
  }
  const target = path.join(LOCAL_EXT_DIR, 'skills', meta.name);
  ensureDir(path.dirname(target));
  fs.cpSync(sourceDir, target, { recursive: true, dereference: true });
  const registry = loadRegistry();
  registry.skills[meta.name] = true;
  saveRegistry();
}

/** 把本地目录导入为连接器 */
export function importConnector(sourceDir: string): void {
  if (!fs.existsSync(path.join(sourceDir, 'connector.json'))) {
    throw new Error('目录缺少 connector.json，无法导入连接器');
  }
  const meta = readConnectorMeta(sourceDir);
  if (meta.invalid) {
    throw new Error('connector.json 解析失败，无法导入');
  }
  const existing = listConnectors().find(c => c.name === meta.name);
  if (existing) {
    throw new Error(`连接器名称冲突：${meta.name} 已存在`);
  }
  const target = path.join(LOCAL_EXT_DIR, 'connectors', meta.name);
  ensureDir(path.dirname(target));
  fs.cpSync(sourceDir, target, { recursive: true, dereference: true });
  const registry = loadRegistry();
  registry.connectors[meta.name] = { enabled: true, lastError: null };
  saveRegistry();
}

/**
 * 返回启用技能的绝对路径数组，供 Workspace skills resolver 使用。
 * 当 requestContext.skill 被设置时，把对应技能目录置顶并强制包含（即使被禁用）。
 */
export function enabledSkillDirs(
  requestContext?: { skill?: string } | Map<string, unknown>
): string[] {
  const skills = listSkills();
  const dirByName = new Map(skills.map(s => [s.name, s.dir]));

  const dirs: string[] = [];
  for (const s of skills) {
    if (s.enabled) dirs.push(s.dir);
  }

  let requested: string | undefined;
  if (requestContext instanceof Map) {
    requested = requestContext.get('skill') as string | undefined;
  } else if (requestContext && typeof requestContext.skill === 'string') {
    requested = requestContext.skill;
  }

  if (requested) {
    const targetDir = dirByName.get(requested);
    if (targetDir) {
      const idx = dirs.indexOf(targetDir);
      if (idx > 0) {
        dirs.splice(idx, 1);
      }
      if (dirs[0] !== targetDir) {
        dirs.unshift(targetDir);
      }
      // 若被禁用，idx 为 -1，直接强制置首
    }
  }

  return dirs;
}
