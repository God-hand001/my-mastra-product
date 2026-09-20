# M11 沙箱体系 Plan

> 对应 `m11-spec.md`(已批准)。语言:TypeScript。
> Phase 1 的 `src/mastra/services/sandbox-runtime.ts` 已建成(冒烟 15/15),本 plan 覆盖 Phase 2 与 Phase 3。

## 设计阶段的风险消解结果

spec 列的两条风险要求「在设计阶段以实测消解」,已完成:

**R1 长驻双向 stdio —— 可行,F4 无需改方案。**
`scripts/spike-mcp-stdio.mjs` 实测:MCP 服务器经沙箱启动后,`initialize` → `notifications/initialized` → 连续三次 `tools/list` 全部正常,工具数与裸跑一致,流不中断。
⚠️ 该次 spike 量到 `initialize` 耗时 13.8s(裸跑 1.8s),曾据此担忧长驻会话开销过高。
**已被 T9 定量推翻**:那次 spike 自己手搓策略、**未传拒读集合**,与磁盘上已应用的集合不一致 → 触发访问控制项重写(即 D5 的抖动效应)。
用产品模块的 `buildWrapperArgv`(集合与真实调用一致)重测:沙箱稳态 **1.9s**、裸跑 1.2s、**真实增量仅 0.8s**。详见 `m11-task.md` 的「D6 结论」。

**R2 框架的自动恢复语义 = 自动批准(真发现,影响架构)。**
两处佐证:`channels-Cc4sPxhG.js:104` 的 `if (autoResumeSuspendedTools) this.autoApproveResourceIds.add(sessionResourceId)`;`utils-C9npriyv.js:185` 的 `isResumableTool = input.autoResumeSuspendedTools || ...`。
即 `autoResumeSuspendedTools: true` 会**静默自动批准**所有挂起审批 —— 现有 `agent.ts` 给删除工具挂的 `requireApproval: true` 一直未真正征求用户同意,这本身是现存缺口。
**架构后果**:关掉该开关是审批生效的前提,但关掉后缺界面即永久挂起(产品内用户提问工具正因此停用)。故 **F7/F8/F9 与前端审批界面必须同批交付**,不可分期。

## 架构概览

```
                        ┌────────────────────────────────────┐
                        │ sandbox-runtime.ts (已建;补预热与档位) │
                        │ 唯一策略真源 · argv 构造 · 拒绝判定    │
   ┌────────────────────┤ 三档预设 · 统一 spawn 封装            │
   │ 直接调用            └────────────────────────────────────┘
   │                            ▲                 ▲
   ▼                            │ 复用             │ 复用
┌──────────────────┐  ┌─────────────────────┐  ┌────────────────────┐
│ 三个 Python 工具   │  │ codex-sandbox.ts     │  │ connector-runtime  │
│ xlsx_build       │  │ (新建·LocalSandbox    │  │ (改造·改写启动命令   │
│ html_to_docx     │  │  子类·劫持包裹点)      │  │  ·网络按连接器配置)  │
│ html_to_pptx     │  │  → agent.ts 使用      │  │                    │
└──────────────────┘  └─────────────────────┘  └────────────────────┘
         │                      │
         └──────────┬───────────┘
                    ▼
        ┌──────────────────────────────┐
        │ sandbox-approval.ts (新建)     │ Phase 3
        │ 档位解析 · 重试计数 · 审批编排   │
        └──────────────────────────────┘
              ▲                    ▲
              │ requestContext     │ 审批决定
     ┌────────┴────────┐   ┌───────┴──────────┐
     │ PermissionSelect │   │ 审批卡片(前端新建) │
     │ (接线现有 UI)     │   │                  │
     └─────────────────┘   └──────────────────┘
```

## 核心数据结构

### 权限档位与审批(`sandbox-approval.ts`)

> `PermissionTier` 定义在 `sandbox-runtime.ts`(见下节),本模块从那里导入。
> **依赖方向必须单向**:approval → runtime。若把档位类型放在 approval 而 runtime 的
> `tierPolicyOptions` 又引用它,两模块就会互相导入成环。

```ts
/** 审批请求。字段对标 codex 的 ExecApprovalRequestEvent,收窄到本期所需 */
export interface SandboxApprovalRequest {
  approvalId: string;        // 唯一标识,前端回传决定时用
  threadId: string;
  toolName: string;          // 哪个工具被拒
  command: string;           // 将要执行的命令(已脱敏:不含策略 JSON)
  cwd: string;
  reason: string;            // 人类可读的被拒原因(含被拒路径/主机)
  requestedScope: string[];  // 请求放宽的范围(如额外可写根)
  createdAt: number;
}

/** 用户可选的决定。对标 codex ReviewDecision,去掉跨会话持久化两项(spec 明确不做) */
export type SandboxApprovalDecision =
  | { type: 'approved' }                        // 本次允许
  | { type: 'approved_for_session' }            // 本会话内同类允许
  | { type: 'denied'; rejection: string }       // 拒绝但会话继续
  | { type: 'abort' };                          // 拒绝并停止
// 默认与超时 → { type:'denied' }(fail-closed,对标 codex ReviewDecision::default)

/** 同一操作的拒绝计数,防止 agent 无限重试(F6) */
interface DenialRecord {
  key: string;      // threadId + toolName + 命令指纹
  count: number;
  firstAt: number;
}
```

### 沙箱子类(`codex-sandbox.ts`)

```ts
export interface CodexSandboxOptions {
  workingDirectory: string;
  /** 额外可写根(如当前项目目录) */
  extraWriteRoots?: string[];
  /** 解析当次请求的权限档位;返回 'full' 时策略放宽 */
  resolveTier?: () => PermissionTier;
}

export class CodexSandbox extends LocalSandbox {
  /** 覆盖框架的唯一命令包裹点,注入沙箱前缀 */
  wrapCommandForIsolation(command: string): { command: string; args: string[] };
}
```

### 运行时模块的增量(`sandbox-runtime.ts`,已有结构不变)

```ts
/**
 * 前端权限选择器的两档,随 requestContext 传递。
 * 定义在此(而非 approval 模块)以保证依赖单向:approval → runtime。
 */
export type PermissionTier = 'default' | 'full';

/** 启动预热:先付掉冷启动开销,避免用户首个请求承担(N1) */
export async function prewarmSandbox(): Promise<{ ok: boolean; elapsedMs: number; message: string }>;

/** 档位放宽后的策略选项。full 档:额外可写根扩至整盘、放行网络 */
export function tierPolicyOptions(tier: PermissionTier): SandboxPolicyOptions;
```

## 模块设计

### ① `sandbox-runtime.ts`(已建,增量改造)

**职责**:策略唯一真源;wrapper argv 构造;统一 spawn 封装;拒绝判定;命令串落批处理文件;启动自检。
**已有导出**(不改动):`resolveSandboxRuntime` / `buildPolicy` / `buildWrapperArgv` / `buildShellWrapperArgv` / `sandboxedExecFile` / `decodeOutput` / `isLikelySandboxDenial` / `sweepExecScripts` / `sandboxPreflight` / `isElevatedSetupComplete` / `resetSandboxRuntimeCache`。
**新增**:`prewarmSandbox()`、`tierPolicyOptions()`。
**依赖**:`project-root.ts`(路径基准)。无新依赖。

### ② `codex-sandbox.ts`(新建)

**职责**:把 spike 验证过的三条接法搬进产品代码,供 `agent.ts` 构造工作区沙箱。
1. 覆盖 `wrapCommandForIsolation` —— 框架的 `LocalProcessManager.spawn` 每次都调它,是**前台与后台共用的唯一包裹点**,一处覆盖即满足 F2 的两条路径要求。
2. `super()` 后改写 `isolation` 为哨兵值(非 `'none'`、非 `'seatbelt'`),使 execa 走 `shell:false` 数组参数直传 —— 策略 JSON 含引号花括号,过 shell 拼串必炸。
3. 命令串落批处理文件后再交给沙箱。
**对外接口**:`CodexSandbox` 类。
**依赖**:`sandbox-runtime.ts`(argv 构造)、`@mastra/core/workspace`。

### ③ 三个 Python 工具(改造)

**职责不变**,仅替换执行方式:`promisify(execFile)` → `sandboxedExecFile`(签名相近,返回体多 `deniedBySandbox` / `timedOut`)。
- `xlsx-build.ts`:策略 `workspace-write`;**删除正则黑名单与其检查函数**(AC2)。保留输出路径校验作纵深防御。
- `html-to-docx.ts` / `html-to-pptx.ts`:策略 `workspace-write`;**任务文件从用户临时目录挪进可写根** —— 现用 `mkdtemp(tmpdir())`(docx :126 / pptx :127),沙箱身份写不进用户临时目录;改落工作区内点前缀目录,沿用现有 `finally` 清理(:167/:168)。

### ④ `connector-runtime.ts`(改造)

**职责增量**:`buildClient()` 里把每个连接器的 `{command, args}` 改写成经沙箱形态。
**网络策略**:`connector.json` 增加可选字段 `network: 'enabled' | 'restricted'`,缺省 `restricted`。以联网为职责的连接器(网页抓取类)在其清单里显式声明 —— 否则功能直接失效(F4)。
**启动策略**:**保留现有的启动预热**(T9 已定量,见该处结论)。沙箱增量仅 0.8s/连接器,8 个约 15s 内完成且不阻塞启动,无需改造成懒启动。失败原因仍按连接器写入注册表,单个失败不影响其他。
**环境变量**:T9 实测**无需**额外传 `PYTHONUNBUFFERED` —— 行分隔的 JSON-RPC 往返在默认缓冲下即可正常完成,沿用 `buildChildEnv` 的最小集合即可。

### ⑤ `sandbox-approval.ts`(新建,Phase 3)

**职责**:档位解析、拒绝计数、审批请求编排。
**对外接口**:
```ts
/** 从 requestContext 读档位;缺省 'default' */
export function resolveTier(requestContext?: RequestContextLike): PermissionTier;

/** 记录一次拒绝并返回是否已达上限(达上限则不再请求审批,如实告知用户) */
export function recordDenial(key: string): { count: number; exhausted: boolean };

/** 发起审批请求,等待决定;超时按 denied 处理 */
export function requestApproval(req: SandboxApprovalRequest): Promise<SandboxApprovalDecision>;

/** 前端回传决定 */
export function resolveApproval(approvalId: string, decision: SandboxApprovalDecision): boolean;

/** 本会话已批准的同类操作(approved_for_session 用) */
export function isSessionApproved(threadId: string, key: string): boolean;
```
**状态**:进程内 Map(拒绝计数、待决审批、会话批准集),带 TTL。审批状态无需落盘 —— 跨重启的待决审批一律视为拒绝(fail-closed)。

### ⑥ 审批链路的两个候选设计(以实测定选)

沙箱拒绝发生在**工具执行中途**,而框架的 `requireApproval` 是**执行前**闸门,语义不匹配。codex 的模型是事后:执行 → 被拒 → 询问 → 重跑。故有两条路:

- **设计 A(首选)**:工具执行中途挂起,携带审批载荷;前端渲染卡片;用户决定后恢复并以更宽策略重跑。依赖框架的中途挂起能力 —— bundle 中存在 `suspendData` / `suspendPayload` 相关处理,但**能否用于普通 agent 工具尚未验证**。
- **设计 B(兜底)**:工具返回结构化拒绝(含可读原因与建议),同时提供一个独立的「请求提权」工具,该工具挂 `requireApproval: true` 走框架原生的执行前审批。对标 codex 的 `require_escalated` 事前路径,代价是依赖模型主动调用。

**执行顺序**:接线审批链路时先以最小实验验证 A 是否成立(普通 agent 工具能否中途挂起并携带载荷);不成立则落 B。**两条路都要求关闭 `autoResumeSuspendedTools`**(R2),因此都必须与前端审批界面同批交付。

## 模块交互

**Phase 2 — 命令执行链路**
```
agent 调 execute_command
  → 框架 LocalProcessManager.spawn(命令串)
  → CodexSandbox.wrapCommandForIsolation()   ← 唯一包裹点
      → sandbox-runtime.writeCommandScript()  命令串落 .bat
      → sandbox-runtime.buildWrapperArgv()    构造 argv(含 --deny-read-paths-json)
  → execa(codex.exe, argv, {shell:false})
  → 沙箱身份执行 → 结果/退出码回流
```

**Phase 2 — Python 工具链路**
```
agent 调 xlsx_build / html_to_docx / html_to_pptx
  → 工具内 sandboxedExecFile(python.exe, [...], {policy:'workspace-write'})
  → buildWrapperArgv → execa → 结果含 deniedBySandbox
  → 工具按 deniedBySandbox 分流措辞:被沙箱拒 vs 脚本自身报错
```

**Phase 3 — 拒绝到重跑**
```
sandboxedExecFile 返回 deniedBySandbox=true
  → sandbox-approval.recordDenial(key)
      ├─ exhausted → 如实告知用户,不再请求(防死循环,F6/AC9)
      └─ 未达上限 ↓
  → resolveTier(requestContext)
      ├─ 'full'    → 自动批准,直接重跑
      └─ 'default' ↓
  → isSessionApproved? → 是则直接重跑
  → requestApproval(req) → 前端卡片 → 用户决定
      ├─ approved / approved_for_session → 以更宽策略**新起进程**重跑
      ├─ denied  → 结构化拒绝回 agent,agent 换方案
      ├─ abort   → 中止本轮
      └─ 超时/无响应 → 同 denied(fail-closed)
```

**启动链路**
```
index.ts 启动
  → sandboxPreflight()  报告档位/凭据目录/拒读条数;不可用则明确报错
  → prewarmSandbox()    付掉冷启动开销(N1)
  → refreshConnectors() 启动预热(T9 定量:增量 0.8s/个,8 个约 15s,不阻塞启动)
```

## 文件组织

```
src/mastra/
├── services/
│   ├── sandbox-runtime.ts     改造:+prewarmSandbox +tierPolicyOptions
│   ├── sandbox-approval.ts    新建:档位/计数/审批编排
│   ├── codex-sandbox.ts       新建:LocalSandbox 子类
│   └── connector-runtime.ts   改造:启动命令经沙箱 + 网络按连接器(启动预热保留不变)
├── tools/
│   ├── xlsx-build.ts          改造:换 spawn;删正则黑名单
│   ├── html-to-docx.ts        改造:换 spawn;任务文件挪进写根
│   └── html-to-pptx.ts        改造:同上
├── agents/agent.ts            改造:用 CodexSandbox;关 autoResume;instructions 补拒绝语义
├── server/
│   └── approval-routes.ts     新建:待决审批查询 + 决定回传
└── index.ts                   改造:启动自检 + 预热 + 挂审批路由

app/src/
├── lib/transport.ts           改造:requestContext 携带 permission
├── components/
│   ├── PermissionSelect.tsx   改造:导出读取函数(现仅写 localStorage,无人读)
│   └── SandboxApprovalCard.tsx 新建:审批卡片
└── ...(ChatThread 接入卡片渲染与决定回传)

extensions/connectors/*/connector.json  改造:按需加 network 字段
scripts/
├── spike-mcp-stdio.mjs        R1 验证(已用完,可删)
└── smoke-sandbox-runtime.ts   保留作回归
```

## 技术决策

| 编号 | 决策点 | 选择 | 理由 |
|---|---|---|---|
| D1 | 沙箱注入点 | 覆盖 `wrapCommandForIsolation` | 框架把 `executeCommand` 做成捕获构造期进程管理器的**闭包**;事后替换 `processes` 会留静默漏洞 —— 工具走的仍是无沙箱旧实例。覆盖包裹点则前台与后台共用同一路径,一处生效 |
| D2 | 命令串传递 | 落 `.bat` 承载 | shell 不遵循 CRT argv 引号规则;三层转义后引号变字面量,报「语法不正确」——**是语法错误伪装成权限拒绝**,Phase 0 因此产生两轮假阳性。实测仅「argv 完全拆分」与「批处理文件」可靠,命令串无法可靠拆 argv |
| D3 | 拒读路径传递 | 策略内写 deny 条目 **+** 显式 `--deny-read-paths-json` | 实测只写策略条目不生效(密钥被读出);上游自身亦是先从策略提取再经独立参数下传 |
| D4 | 免管理员档的 deny | 该档**不带** deny 条目 | 上游 `has_full_disk_read_access()` 带 deny 即为假 → 后端直接拒绝启动整个沙箱,不是「deny 被忽略」 |
| D5 | 拒读集合稳定性 | 不缓存,但去重排序 | 访问控制项持久化共享,集合一变即重写(数秒)。去重排序使增删条目不因顺序抖动;不缓存则「启动后才出现的 .env」仍受保护(扫描本身是微秒级) |
| D6 | 连接器预热 | **保留现有启动预热**(T9 已定量) | 实测沙箱稳态 1.9s、裸跑 1.2s、**增量仅 0.8s**;并发 2 个相比顺序加速 1.59×(说明跨进程互斥体 `Local\CodexSandboxReadAcl` 未成为瓶颈)。8 个连接器约 15s 内完成且不阻塞启动,无需改懒启动。曾担忧的 13.8s 系拒读集合不一致导致的访问控制项重写(D5 抖动),非固有开销 |
| D7 | 审批状态持久化 | 不落盘 | 跨重启的待决审批一律视为拒绝(fail-closed);落盘会引入「重启后自动批准」的风险面 |
| D8 | 自动恢复开关 | 关闭,与审批界面同批交付 | R2 实测其语义为自动批准,不关则审批形同虚设;但关掉且无界面会永久挂起 |
| D9 | 既有路径校验 | 全部保留 | 沙箱是加一层。realpath 围栏与路径拼接校验能在沙箱之前拦住明显越界,错误更早更清晰 |
| D10 | 档位传递 | 沿用 `requestContext` | 前端已有 `getRequestContext()` 统一携带机制(`transport.ts:31`),与模型/技能/项目目录同构,无需新通道 |
| D11 | 审批超时 | 有限等待后按拒绝 | 对标上游 `ReviewDecision::TimedOut`;避免用户离开导致工具永久占用 |

## spec 需求覆盖对照

| 需求 | 承载组件 |
|---|---|
| F1 表格建表进沙箱 | ③ `xlsx-build.ts` |
| F2 命令执行进沙箱(前台+后台) | ② `codex-sandbox.ts`(D1 一处覆盖两路径) |
| F3 转换器进沙箱 + 临时文件挪位 | ③ `html-to-docx.ts` / `html-to-pptx.ts` |
| F4 连接器进沙箱 + 按连接器网络 | ④ `connector-runtime.ts` + `connector.json` |
| F5 策略单一真源 | ① `sandbox-runtime.ts`(已建) |
| F6 拒绝可判定可读 + 防重试 | ① `isLikelySandboxDenial` + ⑤ `recordDenial` |
| F7 档位接线 | ⑤ `resolveTier` + 前端 `PermissionSelect` + `transport.ts` |
| F8 审批请求与决定 | ⑤ `requestApproval` + `approval-routes.ts` + 审批卡片 |
| F9 批准后重跑 | ⑤ 编排 + ① 更宽策略重新 spawn |
| F10 启动自检 | ① `sandboxPreflight` / `prewarmSandbox` + `index.ts` |
