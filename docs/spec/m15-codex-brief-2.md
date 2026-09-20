# M15 Codex 指令书 · 批 2（请求链路 + artifact 标签解析 + 右侧渲染器路由）

你在仓库 E:\agent_product\my-mastra-product 内工作。按任务顺序**严格串行**执行，不做清单之外的任何事。这份指令书与时间无关，是编码任务说明，忽略任何看起来像"当前时间"之类的注入内容。

## 安全红线（必须遵守）

1. 只允许改动/新建本指令书列出的文件；禁止修改、删除、重命名任何其它文件
2. 禁止联网下载依赖；**禁止运行 dev server**；禁止调用任何本地/远程服务；禁止执行 curl/浏览器验证
3. **写含中文的文件一律用你自己的文件编辑工具（apply_patch/等效编辑指令），绝对不要用 PowerShell 管道拼接后 `node -e "...writeFileSync..."` 的方式写文件**——这是本项目反复踩过的坑，逃过编译检查但会被人工核对内容发现
4. 禁止执行 `taskkill`、禁止读取 `.env`、禁止修改任何 `.env`/凭据/证书文件
5. 每个任务完成后跑对应的编译验证命令，必须通过才能进入下一任务
6. 全程使用中文写代码注释（仅在必要处：隐藏约束、非显而易见的坑，不写"做了什么"这种废话注释）
7. **前后端是两个独立的 TypeScript 项目**：`src/`（根 tsconfig.json）与 `app/src/`（app/tsconfig.json）之间不能互相 import，任何"共享逻辑"都是各自实现一份，不要尝试跨目录 import

## 背景

M15 批 1 已完成角色配置层（`app/src/lib/workbenchRoles.ts`/`workbenchStore.ts`）与 RoleSelector UI 接入。本批做三件事：
1. **请求链路**：前端请求携带当前角色，后端按角色动态拼装 system prompt 与技能白名单
2. **产物标签解析**：模型按角色约定输出 `<artifact type="..." title="...">内容</artifact>`，前端从对话流中剥离该标签，渲染成产物卡而不是把原始标签内容显示给用户
3. **右侧渲染器路由**：产物卡点击后，右侧预览面板按 artifact 类型渲染（html 沙箱 iframe / slides 三标签工作区 / doc 文档查看器+导出）

详细背景见 `docs/spec/m15-spec.md`（F7-F13）、`docs/spec/m15-plan.md`。

## T3: 请求链路（前端携带角色 + 后端按角色组装）

**文件：** `app/src/lib/transport.ts`（改）、`src/mastra/agents/agent.ts`（改）

### transport.ts 改动

打开该文件，找到 `createTaskTransport` 函数（`body: () => {...}` 工厂）。当前 `requestContext` 对象里已经有 `permission` 字段（`loadPermission()`）。在同一个对象里新增 `role` 字段：

```ts
import { useWorkbenchStore } from './workbenchStore';
```

在 `body: () => { const requestContext = getRequestContext?.(); return { memory: ..., requestContext: { ...(requestContext ?? {}), permission: loadPermission(), role: useWorkbenchStore.getState().roleOf(threadId) } }; }` ——

具体做法：`createTaskTransport(threadId, getRequestContext)` 函数已经有 `threadId` 参数在闭包里可用，直接在 `requestContext` 对象里加一行 `role: useWorkbenchStore.getState().roleOf(threadId)`。注意这里用 `.getState()` 直接读取 store 快照（不是 React hook 调用），因为 transport 的 body 工厂是普通函数不是组件，不能用 `useWorkbenchStore()` 的 hook 形式。

### agent.ts 改动

打开该文件，当前 `instructions` 字段是一个字符串常量（模板字符串，反引号包裹，约第 87-154 行）。需要改成函数形态：

1. 顶部 import 增加：
```ts
import { getRole } from '../../../app/src/lib/workbenchRoles';
```
**等一下——上面这行是错的**，前面安全红线第 7 条已经说明前后端是两个独立 TS 项目，不能跨目录 import。正确做法是：**在 `src/mastra/services/` 目录下新建一个后端自己的角色配置文件**，与前端的 `workbenchRoles.ts` 内容对应但独立维护（两份配置都是纯数据常量，后续如果要改角色文案，两处都要改——这是本项目"学习为主、不追求生产级"决策下可接受的重复，已知取舍，不要尝试消除它）。

新建 `src/mastra/services/workbench-roles.ts`：

```ts
// 场景角色配置(后端副本)。与 app/src/lib/workbenchRoles.ts 的角色 id/systemPrompt/
// artifactHint/enabledSkills 字段必须保持一致 —— 前端决定"显示什么角色可选",
// 后端决定"该角色下模型实际收到什么指令与技能",两处独立维护是本项目的已知取舍
// (前后端是两个独立 TS 项目,不能跨目录共享类型/常量,详见 m15-spec.md N1)。
export type RoleId = 'general' | 'design' | 'slides' | 'writing';

interface RoleBackendConfig {
  id: RoleId;
  systemPrompt: string;
  artifactHint: string;
  enabledSkills: string[] | null;
}

const ROLES: Record<RoleId, RoleBackendConfig> = {
  general: {
    id: 'general',
    systemPrompt: '',
    artifactHint: '',
    enabledSkills: null,
  },
  design: {
    id: 'design',
    systemPrompt: `<!-- 从 app/src/lib/workbenchRoles.ts 的 design.systemPrompt 逐字复制 -->`,
    artifactHint: `<!-- 从 app/src/lib/workbenchRoles.ts 的 design.artifactHint 逐字复制 -->`,
    enabledSkills: ['frontend-design', 'web-artifacts-builder', 'canvas-design', 'brand-guidelines', 'theme-factory'],
  },
  slides: {
    id: 'slides',
    systemPrompt: `<!-- 从 app/src/lib/workbenchRoles.ts 的 slides.systemPrompt 逐字复制 -->`,
    artifactHint: `<!-- 从 app/src/lib/workbenchRoles.ts 的 slides.artifactHint 逐字复制 -->`,
    enabledSkills: ['pptx'],
  },
  writing: {
    id: 'writing',
    systemPrompt: `<!-- 从 app/src/lib/workbenchRoles.ts 的 writing.systemPrompt 逐字复制 -->`,
    artifactHint: `<!-- 从 app/src/lib/workbenchRoles.ts 的 writing.artifactHint 逐字复制 -->`,
    enabledSkills: ['doc-coauthoring', 'internal-comms'],
  },
};

export function getRoleConfig(id: unknown): RoleBackendConfig {
  if (typeof id === 'string' && id in ROLES) return ROLES[id as RoleId];
  return ROLES.general;
}
```

**关键要求：`design`/`slides`/`writing` 三个角色的 `systemPrompt` 与 `artifactHint` 字段，必须打开 `app/src/lib/workbenchRoles.ts` 读取对应角色的真实文案，逐字复制过来（去掉上面示例里的占位注释），不要自己改写或从 spec 文档重新组织**。这是同一份文案在前后端各存一份，必须逐字一致，否则模型收到的指令和产品文档里描述的行为会不一致。

2. `agent.ts` 里的 `instructions` 字段（当前是模板字符串常量）改为函数：

```ts
instructions: ({ requestContext }) => {
  const roleId = requestContext?.get('role');
  const role = getRoleConfig(roleId);
  const base = `<!-- 原有的整段基础指令字符串,原样保留,不要改动任何一个字 -->`;
  if (!role.systemPrompt) return base;
  return `${base}\n\n${role.systemPrompt}\n\n${role.artifactHint}`;
},
```

把原来 `instructions: \`...\`,` 的整段模板字符串内容原样挪进 `base` 变量里（一个字都不要改），只是把外层从"字符串字面量"变成"返回字符串的箭头函数"。

3. `skills` resolver（当前已经是函数形态，约第 185-200 行）在现有逻辑基础上加角色白名单过滤：

```ts
skills: ({ requestContext }) => {
  if (!requestContext) return enabledSkillDirs();
  const requested = requestContext.get('skill');
  const skillName = typeof requested === 'string' ? requested : undefined;
  const roleId = requestContext.get('role');
  const role = getRoleConfig(roleId);
  let dirs = enabledSkillDirs({ skill: skillName });
  // F8:角色 enabledSkills 非空时,只保留白名单内的技能目录(按目录名匹配技能名);
  // F9:显式指定的技能(skillName)不受角色白名单限制,即使不在白名单也要保留 ——
  // 用户手动选的技能优先级高于角色默认限制。
  if (role.enabledSkills) {
    const whitelist = new Set(role.enabledSkills);
    dirs = dirs.filter(dir => {
      const dirName = dir.split(/[\\/]/).pop() ?? '';
      return whitelist.has(dirName) || dirName === skillName;
    });
  }
  if (!skillName) return dirs;
  return [
    ...dirs,
    createSkill({
      name: 'user-requested-skill',
      description: `用户在本条消息中通过输入框明确指定使用技能「${skillName}」`,
      instructions: `用户在本条消息中通过输入框明确指定使用技能「${skillName}」。处理本次请求时,应优先调用 skill 工具读取技能「${skillName}」的完整内容并遵循其指示;该技能与本任务只有部分相关时也应尽量结合。`,
    }),
  ];
},
```

注意：`enabledSkillDirs` 返回的是绝对路径数组（如 `E:\...\extensions\skills\frontend-design`），过滤时要按路径最后一段（目录名）跟白名单里的技能名（如 `'frontend-design'`）比较，不能直接把整个绝对路径跟白名单字符串比较。

**验证：** 根目录 `npx tsc --noEmit` 通过；`cd app && npx tsc --noEmit` 通过

## T4: artifact 标签解析与剥离

**文件：** `app/src/lib/artifactTag.ts`（新建）、`app/src/components/AssistantSteps.tsx`（改）

### artifactTag.ts

参照 `app/src/lib/artifacts.ts` 现有的【产物:】标记解析风格（正则 + matchAll），实现：

```ts
// <artifact> 标签协议解析:角色约束模型把交付产物放进 <artifact> 标签,
// 前端从对话流中剥离该标签内容,转换成产物卡送右侧预览,而不是把原始标签
// 内容(可能是几十 KB 的 HTML)直接显示在聊天气泡里。
export interface ArtifactTag {
  type: 'html' | 'slides' | 'doc';
  title: string;
  content: string;
  raw: string; // 完整匹配到的原始标签文本,用于从正文里剔除
}

// type 属性可能缺失(F12:模型没按格式输出 type 时,由调用方按当前角色 artifactType 补齐)。
// 非贪婪 + dotAll(s 标志)让 . 能匹配换行,支持多行 HTML 内容;g 标志支持多实例。
const ARTIFACT_TAG_PATTERN = /<artifact(?:\s+type="([^"]*)")?\s+title="([^"]*)"\s*>([\s\S]*?)<\/artifact>/g;

const VALID_TYPES = new Set(['html', 'slides', 'doc']);

// fallbackType:当标签缺 type 属性时用什么类型兜底(通常是当前会话角色的 artifactType)
export function parseArtifactTags(text: string, fallbackType?: string): ArtifactTag[] {
  const results: ArtifactTag[] = [];
  for (const match of text.matchAll(ARTIFACT_TAG_PATTERN)) {
    const rawType = match[1];
    const resolvedType = VALID_TYPES.has(rawType ?? '') ? rawType : fallbackType;
    if (!resolvedType || !VALID_TYPES.has(resolvedType)) continue; // 无法确定类型的标签跳过,不渲染成产物卡(F13 兜底)
    results.push({
      type: resolvedType as ArtifactTag['type'],
      title: match[2].trim(),
      content: match[3],
      raw: match[0],
    });
  }
  return results;
}

// 从正文中剔除已解析的 artifact 标签,剩余部分按普通 Markdown 渲染
export function stripArtifactTags(text: string): string {
  return text.replace(ARTIFACT_TAG_PATTERN, '').trim();
}
```

**测试用例自查（写完后自己在脑内/用临时 node 脚本跑一遍，不要新建测试文件，验证完删掉临时脚本）：**
1. 单标签：`<artifact type="html" title="test">内容</artifact>` → 解析出 1 条，type=html
2. 多标签：文本里出现两次 `<artifact>` → 解析出 2 条
3. 跨行：标签内容包含多行 HTML（含换行符）→ 完整捕获，不被截断
4. 缺 type：`<artifact title="test">内容</artifact>` + fallbackType='doc' → type 正确补齐为 doc
5. 缺 type 且无 fallbackType → 该条目被跳过（不出现在结果里）

### AssistantSteps.tsx 改动

找到 `AssistantText` 函数（约第 32-73 行）。当前逻辑：`parseArtifacts` 解析【产物:】标记 → `stripArtifactMarkers`/`stripWebPageMarkers` 清洗 → 渲染 `ArtifactCard`。

需要在【产物:】清洗**之前**先剥离 `<artifact>` 标签：

1. `AssistantText` 增加一个 prop：`roleArtifactType?: string`（当前会话角色的 artifactType，用作 fallbackType）
2. 函数开头：
```ts
function AssistantText({ text, roleArtifactType }: { text?: string; roleArtifactType?: string }) {
  if (text === undefined) return <MarkdownText />;

  const artifactTags = parseArtifactTags(text, roleArtifactType);
  const textAfterArtifactTags = stripArtifactTags(text);

  const artifacts = parseArtifacts(textAfterArtifactTags);
  const webPages = parseWebPages(textAfterArtifactTags);
  const cleanedText = stripWebPageMarkers(stripArtifactMarkers(textAfterArtifactTags));
  // ...(其余逻辑不变,把后面用到 text 的地方全部换成 textAfterArtifactTags 或 cleanedText)
```
3. 在渲染部分（`otherArtifacts.map(...)` 附近）新增 artifact 标签卡片渲染。**不要新建 ArtifactCard 的变体组件**——直接在 `AssistantText` 返回的 JSX 里加一段，点击时通过 `window.dispatchEvent` 触发已有的 `h0-open-artifact` 事件，但 detail 携带的数据结构要能区分"标签产物"与"文件产物"：

```tsx
{artifactTags.map((tag, i) => (
  <div
    key={`artifact-tag-${i}`}
    className="artifact-long-card"
    onClick={() => window.dispatchEvent(new CustomEvent('h0-open-artifact', {
      detail: { kind: 'artifact-tag', type: tag.type, title: tag.title, content: tag.content },
    }))}
    role="button"
    tabIndex={0}
    onKeyDown={e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('h0-open-artifact', {
          detail: { kind: 'artifact-tag', type: tag.type, title: tag.title, content: tag.content },
        }));
      }
    }}
  >
    <div className="artifact-long-card-head">
      <span className="artifact-icon" style={{ backgroundColor: tag.type === 'html' ? '#e34c26' : tag.type === 'slides' ? '#d24726' : '#4a5568' }}>
        {tag.type === 'html' ? '</>' : tag.type === 'slides' ? 'P' : 'D'}
      </span>
      <div className="artifact-info">
        <div className="artifact-name">{tag.title}</div>
        <div className="artifact-sub">{tag.type === 'html' ? '网页' : tag.type === 'slides' ? '幻灯片' : '文档'}</div>
      </div>
    </div>
  </div>
))}
```

（这段是最小实现，不追求跟 ArtifactCard.tsx 里的三点菜单/内联预览完全对齐——那些是给"文件产物"设计的，标签产物内容在内存里不落盘，没有文件系统操作的意义）

4. `AssistantMessage`（在 `ChatThread.tsx` 里，调用 `AnswerParts`/`StepsFold` 内部会渲染到 `AssistantText`）需要能把当前角色的 `artifactType` 传下去。**由于 `MessagePrimitive.PartByIndex` 的 `components` 配置（`PART_COMPONENTS`）是模块级常量，不能直接传 props**——用 React Context 解决：在 `AssistantSteps.tsx` 顶部新增一个 Context：

```ts
import { createContext, useContext } from 'react';

// 当前会话角色的 artifactType,供 AssistantText 在 <artifact> 缺 type 属性时兜底(F12)。
// 用 Context 而不是 props:AssistantText 是通过 MessagePrimitive.PartByIndex 的
// components 配置渲染的,配置对象是模块级常量,渲染时机上组件拿不到外部 props,
// 只能靠 Context 从祖先节点传值。
export const RoleArtifactTypeContext = createContext<string | undefined>(undefined);
```

`AssistantText` 内部改用 `const roleArtifactType = useContext(RoleArtifactTypeContext);` 读取，不再作为 prop 传入（去掉 T4 步骤 2 里写的 prop 签名，改成组件内部读 Context）。

在 `ChatThread.tsx` 里找到 `ThreadContext.Provider`（约第 706-710 行）那一圈 Provider，在同一层级加一个 `RoleArtifactTypeContext.Provider`，value 用 `getRole(useWorkbenchStore(state => state.roleOf(threadId))).artifactType`（需要 import `getRole`、`useWorkbenchStore`）。

**验证：** `cd app && npx tsc --noEmit` 通过

## T5: 右侧渲染器路由

**文件：** `app/src/components/PreviewPanel.tsx`（改）、`app/src/components/SlidesWorkspace.tsx`（新建）、`app/src/components/DocViewer.tsx`（新建）、`app/src/routes/TaskPage.tsx`（改）、`src/mastra/server/workspace-routes.ts`（改，新增两个导出端点）

### 后端：新增导出端点（workspace-routes.ts）

产物标签的内容在浏览器内存里，不是 workspace 里的文件，所以"导出 PPTX/导出 Word"按钮需要后端提供两个直接接收 HTML 字符串、返回文件二进制的端点（而不是走 agent 工具调用）。

打开 `src/mastra/tools/html-to-docx.ts` 与 `src/mastra/tools/html-to-pptx.ts`，把 `execute: async ({ html, outputPath }) => {...}` 函数体**抽成一个独立导出的函数**（不改变原有工具的行为，只是把逻辑挪到一个可被路由文件复用的函数里）：

以 `html-to-docx.ts` 为例，改动方式：

```ts
// 把原来 execute 里的全部逻辑挪进这个函数,工具的 execute 直接调用它
export async function convertHtmlToDocx(html: string, outputPath: string) {
  // ...原来 execute 函数体的全部内容,一字不改...
}

export const htmlToDocxTool = createTool({
  // ...其余字段不变...
  execute: async ({ html, outputPath }) => convertHtmlToDocx(html, outputPath),
});
```

`html-to-pptx.ts` 同样处理，导出函数命名为 `convertHtmlToPptx`。

然后在 `workspace-routes.ts` 顶部 import 这两个新导出的函数，新增两个端点（放在文件末尾 `export const workspaceRoutes = [...]` 数组的最后两项之前）：

```ts
// POST /workspace/export/docx  { html, title } → 转换后返回 .docx 二进制供前端直接下载
// 产物标签的内容只存在于浏览器内存,不是 workspace 文件,所以先转换到 workspace 内的
// 临时目录再读出二进制返回,不落地为"正式产物"(不出现在产物列表里,用完即删)。
registerApiRoute('/workspace/export/docx', {
  method: 'POST',
  handler: async c => {
    try {
      const body = await c.req.json<{ html?: unknown; title?: unknown }>();
      const html = typeof body.html === 'string' ? body.html : '';
      const title = typeof body.title === 'string' && body.title ? body.title : '文档';
      if (!html) return c.json({ error: '缺少 html 参数' }, 400);
      const tempRelPath = `.mew-exports/${randomUUID()}.docx`;
      const result = await convertHtmlToDocx(html, tempRelPath);
      if (!result.success || !result.outputPath) {
        return c.json({ error: result.error ?? '转换失败' }, 500);
      }
      const buf = await readFile(result.outputPath);
      await rm(path.dirname(result.outputPath), { recursive: true, force: true }).catch(() => undefined);
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(title)}.docx"`,
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return c.json({ error: `导出失败: ${reason}` }, 500);
    }
  },
}),
```

同样新增 `POST /workspace/export/pptx`（`Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation`，扩展名 `.pptx`，调用 `convertHtmlToPptx`），逻辑完全对称。

注意：
- `randomUUID` 从 `node:crypto` import（文件顶部已有其它 import，加一行）
- 临时文件目录用 `.mew-exports/` 前缀（点号开头），与现有 `.mew-convert/` 命名风格一致，且会被现有的"隐藏 . 开头目录"逻辑自动排除在产物列表外（第 207 行 `visibleEntries` 过滤逻辑不用改，天然生效）
- `result.outputPath` 是 `convertHtmlToDocx`/`convertHtmlToPptx` 返回对象里的字段（沿用原函数返回结构，即 `{ success, outputPath, error, warnings }`）

### 前端：PreviewPanel.tsx 改动

1. `PreviewPayload` 类型新增一个变体：
```ts
| { kind: 'artifact-tag'; artifactType: 'html' | 'slides' | 'doc'; title: string; content: string }
```
2. `PreviewTab['kind']` 联合类型新增 `'artifact-tag'`
3. `PreviewContent` 组件（渲染 tab 内容的地方）新增一个分支：
```tsx
{tab.kind === 'artifact-tag' && tab.payload.kind === 'artifact-tag' && (
  <>
    <div className="preview-content-toolbar">{controls}</div>
    <div className="preview-zoom-root" style={{ zoom: zoom / 100 }}>
      {tab.payload.artifactType === 'html' && (
        <iframe
          className="preview-iframe"
          srcDoc={tab.payload.content}
          sandbox="allow-scripts allow-forms"
          title={tab.payload.title}
        />
      )}
      {tab.payload.artifactType === 'slides' && (
        <SlidesWorkspace title={tab.payload.title} content={tab.payload.content} />
      )}
      {tab.payload.artifactType === 'doc' && (
        <DocViewer title={tab.payload.title} content={tab.payload.content} />
      )}
    </div>
  </>
)}
```
（注意 html 分支的 iframe **不加** `allow-same-origin`，这是 N2/AC3 的硬性安全要求）
4. import `SlidesWorkspace`、`DocViewer`

### 前端：SlidesWorkspace.tsx（新建）

```tsx
import { useState } from 'react';
import { API_BASE } from '../lib/apiBase';

interface SlidesWorkspaceProps {
  title: string;
  content: string; // 完整幻灯片 HTML
}

// slides 产物的三标签工作区(F11):幻灯片(iframe 渲染)/大纲(占位说明)/源文件(源码查看)。
// 大纲 tab 的数据源本应是"会话中模型输出的大纲文本",但那段文本在对话流里已经
// 正常展示过(角色 systemPrompt 要求先出大纲再出产物,大纲不走 <artifact> 标签),
// 这里做成占位说明而不是重复抓取历史消息,避免额外的状态管理复杂度
// (spec 允许的简化,已在 plan.md 里作为技术决策记录)。
export function SlidesWorkspace({ title, content }: SlidesWorkspaceProps) {
  const [tab, setTab] = useState<'deck' | 'outline' | 'source'>('deck');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const exportPptx = async () => {
    setExporting(true);
    setExportError('');
    try {
      const res = await fetch(`${API_BASE}/workspace/export/pptx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: content, title }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `导出失败: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="slides-workspace">
      <div className="slides-workspace-tabs">
        <button type="button" className={tab === 'deck' ? 'is-active' : ''} onClick={() => setTab('deck')}>幻灯片</button>
        <button type="button" className={tab === 'outline' ? 'is-active' : ''} onClick={() => setTab('outline')}>大纲</button>
        <button type="button" className={tab === 'source' ? 'is-active' : ''} onClick={() => setTab('source')}>源文件</button>
        <button type="button" className="slides-export-btn" onClick={exportPptx} disabled={exporting}>
          {exporting ? '导出中…' : '导出 PPTX'}
        </button>
      </div>
      {exportError && <div className="slides-export-error">{exportError}</div>}
      {tab === 'deck' && (
        <div className="slides-deck-canvas">
          <iframe
            className="slides-deck-iframe"
            srcDoc={content}
            sandbox="allow-scripts allow-forms"
            title={title}
          />
        </div>
      )}
      {tab === 'outline' && (
        <div className="slides-outline-placeholder">大纲已在对话中输出，请向上滚动对话查看确认过的大纲内容。</div>
      )}
      {tab === 'source' && (
        <div className="slides-source-view">
          <button
            type="button"
            className="slides-source-copy"
            onClick={() => navigator.clipboard.writeText(content)}
          >
            复制源码
          </button>
          <pre className="preview-code">{content}</pre>
        </div>
      )}
    </div>
  );
}
```

### 前端：DocViewer.tsx（新建）

```tsx
import { useState } from 'react';
import { API_BASE } from '../lib/apiBase';

interface DocViewerProps {
  title: string;
  content: string; // HTML 文档片段(角色约定:doc 产物 content 是 HTML,不是 Markdown)
}

// doc 产物 content 是 HTML 文档片段(writing 角色的 artifactHint 已约定模型直接输出
// HTML 而非 Markdown 源码),因此这里用 iframe 渲染而不是 MarkdownText——
// 避免把模型输出的 HTML 标签当纯文本转义显示。
export function DocViewer({ title, content }: DocViewerProps) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const exportDocx = async () => {
    setExporting(true);
    setExportError('');
    try {
      const res = await fetch(`${API_BASE}/workspace/export/docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: content, title }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `导出失败: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="doc-viewer">
      <div className="doc-viewer-toolbar">
        <button type="button" className="doc-export-btn" onClick={exportDocx} disabled={exporting}>
          {exporting ? '导出中…' : '导出 Word'}
        </button>
      </div>
      {exportError && <div className="doc-export-error">{exportError}</div>}
      <iframe
        className="doc-viewer-iframe"
        srcDoc={content}
        sandbox="allow-scripts"
        title={title}
      />
    </div>
  );
}
```

### 前端：TaskPage.tsx 改动

找到 `h0-open-artifact` 事件监听（约第 490-499 行 `handleOpenArtifact`）。当前只处理 `detail.name`/`detail.path` 形态（文件产物）。新增对 `detail.kind === 'artifact-tag'` 形态的处理：

```ts
const handleOpenArtifact = (event: Event) => {
  const detail = (event as CustomEvent<any>).detail;
  if (detail?.kind === 'artifact-tag') {
    openArtifactTagTab(detail.type, detail.title, detail.content);
    return;
  }
  if (detail?.name && detail?.path) openArtifactTab(detail.name, detail.path);
};
```

新增 `openArtifactTagTab` 函数（放在 `openArtifactTab` 函数定义之后，参考其实现风格——同 payload 去重、reveal 控制面板展开）：

```ts
const openArtifactTagTab = useCallback((artifactType: 'html' | 'slides' | 'doc', title: string, content: string) => {
  const tab: PreviewTab = {
    id: `artifact-tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'artifact-tag',
    title,
    payload: { kind: 'artifact-tag', artifactType, title, content },
  };
  previewTabsRef.current = [...previewTabsRef.current, tab];
  setPreviewTabs(previewTabsRef.current);
  setActivePreviewTabId(tab.id);
  setPreviewOpen(true);
  localStorage.setItem('h0-preview-open-v2', 'true');
}, []);
```

（不做"同内容去重"——标签产物没有稳定的 path 可比较，每次点击开新标签是可接受的简化）

**验证：** `cd app && npm run build` 通过；根目录 `npx tsc --noEmit` 通过（因为改了 workspace-routes.ts 与两个 tool 文件）

## 汇报格式

完成后回复：
1. 改动/新建文件列表
2. 每个任务的编译验证结果
3. **T3 关键自查**：`src/mastra/services/workbench-roles.ts` 里 design/slides/writing 三个角色的 systemPrompt/artifactHint 是否与 `app/src/lib/workbenchRoles.ts` 逐字一致（贴出简单的行数/字符数对比或直接说明如何核对的）
4. T4 的 5 个测试用例（单标签/多标签/跨行/缺type有fallback/缺type无fallback）分别的实际运行结果
5. 遗留问题

不要尝试启动 dev server 或用 curl/浏览器验证功能——运行时验证由我来做。
