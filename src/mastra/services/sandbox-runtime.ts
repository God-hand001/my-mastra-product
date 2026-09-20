// 沙箱运行时(M11-Phase1):所有子进程的统一围栏入口
//
// 背景:文件工具本有 realpath 围栏(LocalFilesystem.contained),但子进程完全裸奔——
// execute_command 无任何限制,xlsx_build 只有 5 条正则黑名单(拦不住 open()/__import__/
// importlib)。agent 写的脚本实际以当前用户全部权限运行,能读 .env/SSH 私钥并联网外发。
//
// 方案:调用 codex 的 Windows 沙箱二进制(vendor/codex/,Apache 2.0),在启动子进程那一
// 瞬间换成受限身份。拦截发生在内核访问检查层,不是字符串匹配。
//   codex.exe --run-as-windows-sandbox <策略> -- <原命令>   ← `--` 后一字不改
//
// 两档能力边界是硬的(codex-rs/sandboxing/src/windows.rs:110-118):
//   restricted-token:仅强制"写"限制(WRITE_RESTRICTED 令牌的限制性 SID 不参与读检查)
//   elevated:        以独立本地账户运行 → 写 + deny-read + WFP 断网(需一次性管理员 setup)
//
// Phase 0 实测结论(scripts/spike-*.mjs,均含正反配对以排除假阳性):
//   - 越界写被内核拒:PermissionError [Errno 13] / Access is denied.
//   - deny-read **必须显式传 --deny-read-paths-json**,只在策略 entries 里写
//     access:'deny' 不生效(实测密钥被读出)
//   - 断网:network:'restricted' → WinError 10013
//   - 跨身份回读通过:沙箱账户产出的文件,后端能读能删 → 预览面板链路无需改动
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { resolveProjectRoot, workspaceRoot } from './project-root';

const execFileAsync = promisify(execFile);

/** 沙箱强度档位。产品默认 elevated;缺 setup 时按 fail-closed 策略报错而非降级。 */
export type SandboxLevel = 'restricted-token' | 'elevated';

/**
 * 前端权限选择器的两档,随 requestContext 传递。
 *
 * 定义在本模块(而非 sandbox-approval)以保证依赖单向:approval → runtime。
 * 若把它放在 approval 而本模块的 tierPolicyOptions 又引用它,两者会互相导入成环。
 */
export type PermissionTier = 'default' | 'full';

/** 策略预设名。读/写/网络是三根独立轴,预设只是常用组合。 */
export type SandboxPolicyName = 'readonly' | 'workspace-write' | 'project-write';

export interface SandboxPolicyOptions {
  /** 额外可写根(绝对路径)。project-write 用它带上当前项目目录。 */
  extraWriteRoots?: string[];
  /**
   * 额外拒读路径(绝对路径),叠加在默认敏感路径之上。
   *
   * ⚠️ **慎用**:deny ACL 按 codex-home 持久化共享,集合一变就要重打 ACL(实测数秒)。
   * 若不同调用传入不同的 extraDenyRead,会来回重打、每次都付这个钱。
   * 长期需要保护的路径应加进 collectDenyReadCandidates() 的默认集合(它被缓存,逐次稳定),
   * 本字段只留给"确实按次不同"的场景。
   */
  extraDenyRead?: string[];
  /** 放行网络。默认断网;仅在明确需要联网的工具上开。 */
  allowNetwork?: boolean;
}

/** codex 策略 JSON 的路径变体(codex-rs/protocol/src/permissions.rs 的 RawFileSystemPath) */
type RawFileSystemPath =
  | { type: 'path'; path: string }
  | { type: 'glob_pattern'; pattern: string }
  | { type: 'special'; value: { kind: 'root' | 'minimal' | 'tmpdir' | 'slash_tmp' } };

interface FileSystemEntry {
  path: RawFileSystemPath;
  access: 'read' | 'write' | 'deny';
}

interface PermissionProfile {
  type: 'managed';
  file_system: { type: 'restricted'; entries: FileSystemEntry[] };
  network: 'restricted' | 'enabled';
}

// ---------------------------------------------------------------- 常量

/** 沙箱二进制:vendor/codex/bin/codex.exe(setup-sandbox-runtime.mjs 放置,必须保留原目录结构) */
const SANDBOX_EXE_REL = path.join('vendor', 'codex', 'bin', 'codex.exe');
/** 项目自带 codex-home:凭据/cap_sid/日志落此处,与用户自己的 codex 装机隔离 */
const SANDBOX_HOME_REL = '.sandbox-home';
/** setup 完成标记(codex-rs/windows-sandbox-rs/src/identity.rs:42 的双文件判据) */
const SETUP_MARKER_REL = path.join('.sandbox', 'setup_marker.json');
const SANDBOX_USERS_REL = path.join('.sandbox-secrets', 'sandbox_users.json');

/**
 * execute_command 的命令串承载目录。
 * 为何要落 .bat:cmd.exe /c **不遵循 CRT argv 引号规则**,命令串经
 * Node → codex.exe → cmd.exe 三层后 \" 被当字面量,报"文件名、目录名或卷标语法不正确"
 * ——那是语法错误不是权限拒绝,会让"越界被拒"变成假阳性(Phase 0 交过两轮学费)。
 * 点前缀目录:workspace-routes.ts 的产物扫描已过滤点前缀。
 */
const EXEC_SCRIPT_DIR_NAME = '.mew-exec';
/** .bat 清理阈值。wrapCommandForIsolation 是同步的,拿不到进程结束时机 → 用扫龄清理 */
const EXEC_SCRIPT_TTL_MS = 30 * 60 * 1000;

/** elevated 档要做 logon + ACL 应用,比 restricted-token 明显慢,超时要留余量 */
const ELEVATED_STARTUP_OVERHEAD_MS = 20_000;

// ---------------------------------------------------------------- 错误

/** 沙箱二进制缺失/损坏。错误信息必须写明尝试过的路径与修复办法(同 python-runtime 约定)。 */
export class SandboxRuntimeMissingError extends Error {
  readonly kind = 'sandbox_runtime_missing';
}

/** elevated 档未完成一次性 setup。fail-closed:报错而非静默降级裸跑。 */
export class SandboxSetupIncompleteError extends Error {
  readonly kind = 'sandbox_setup_incomplete';
}

// ---------------------------------------------------------------- 运行时定位

export interface SandboxRuntime {
  exe: string;
  codexHome: string;
  level: SandboxLevel;
}

let cachedRuntime: SandboxRuntime | null = null;

function sandboxHomePath(): string {
  return process.env.MEW_SANDBOX_HOME || path.join(resolveProjectRoot(), SANDBOX_HOME_REL);
}

/**
 * 复刻 codex 的 sandbox_setup_is_complete(identity.rs:42):
 * setup_marker.json 与 sandbox_users.json 必须同时存在。
 * 注:codex 还校验两者的 version 字段与 SETUP_VERSION 匹配;此处只查存在性,
 * 版本不符时由 codex 自己报错(它的错误信息比我们猜测更准)。
 */
export function isElevatedSetupComplete(codexHome = sandboxHomePath()): boolean {
  return (
    existsSync(path.join(codexHome, SETUP_MARKER_REL)) &&
    existsSync(path.join(codexHome, SANDBOX_USERS_REL))
  );
}

/**
 * 定位沙箱运行时并确定可用档位。
 * env MEW_SANDBOX_LEVEL 可强制档位(开发期调试用);默认 elevated,
 * 未完成 setup 时抛 SandboxSetupIncompleteError —— 不静默降级为 restricted-token,
 * 因为那会悄悄丢掉 deny-read 与断网,让"以为有防护"变成实际没有。
 */
export function resolveSandboxRuntime(): SandboxRuntime {
  if (cachedRuntime) return cachedRuntime;

  if (process.platform !== 'win32') {
    throw new SandboxRuntimeMissingError(
      `codex 沙箱仅支持 Windows(当前 ${process.platform});macOS 走 seatbelt、Linux 走 bwrap,均为另一套后端`,
    );
  }

  const candidates = [
    process.env.MEW_SANDBOX_RUNTIME,
    path.join(resolveProjectRoot(), SANDBOX_EXE_REL),
  ].filter((p): p is string => Boolean(p));

  const exe = candidates.find(p => existsSync(p));
  if (!exe) {
    throw new SandboxRuntimeMissingError(
      `未找到沙箱运行时,尝试过: ${candidates.join(' , ')}\n` +
        `修复: 运行 node scripts/setup-sandbox-runtime.mjs 就位运行时(需保留 bin/ 与 codex-resources/ 原目录结构)`,
    );
  }

  const codexHome = sandboxHomePath();
  const forced = process.env.MEW_SANDBOX_LEVEL;
  let level: SandboxLevel;

  if (forced === 'restricted-token' || forced === 'elevated') {
    level = forced;
  } else {
    level = 'elevated';
  }

  if (level === 'elevated' && !isElevatedSetupComplete(codexHome)) {
    throw new SandboxSetupIncompleteError(
      `沙箱 elevated 档未完成初始化: ${codexHome}\n` +
        `缺少: ${SETUP_MARKER_REL} / ${SANDBOX_USERS_REL}\n` +
        `修复(需管理员 PowerShell,一次即可):\n` +
        `  ${exe} sandbox setup --elevated --current-user --codex-home ${codexHome}\n` +
        `临时绕过(仅开发调试,会失去 deny-read 与断网能力): 设 MEW_SANDBOX_LEVEL=restricted-token`,
    );
  }

  cachedRuntime = { exe, codexHome, level };
  return cachedRuntime;
}

/**
 * 测试/配置变更(尤其改 env MEW_SANDBOX_HOME / MEW_SANDBOX_LEVEL)后重置定位缓存。
 * 拒读集合不缓存,无需在此处理(见 defaultDenyReadPaths)。
 */
export function resetSandboxRuntimeCache(): void {
  cachedRuntime = null;
}

// ---------------------------------------------------------------- 策略

/**
 * 默认拒读路径:凭据与会话态。仅 elevated 档生效。
 *
 * ⚠️ **这个集合应逐次稳定**。deny ACL 是持久化的、按 codex-home 全局共享
 * (deny_read_acl_state.json + sync_persistent_deny_read_acls),集合**一变就要重打 ACL**,
 * 实测代价数秒(scripts/diag-sandbox-perf.mjs:清空既有 deny 集合花了 16.5s)。
 * 集合不变时稳态仅 1.3–2.0s,且与目标规模无关(Edge User Data 的 10390 项不额外收费)。
 *
 * 去重 + 排序把集合规范化,使日后往下面的源列表增删条目不会仅因顺序变化就触发重打。
 * **刻意不缓存**:existsSync 扫这十来条路径是微秒级(实测 buildPolicy 全程 <1ms),
 * 缓存省不下时间,却会让"启动后才出现的 .env"永远不被保护。集合随文件系统变化是
 * 正确行为 —— 变一次、重打一次 ACL,之后照旧稳定。
 *
 * 只收录**存在**的路径 —— 不确定 codex 对不存在的 deny 路径的处理,
 * 宁可少传也不冒"整条策略被拒"的风险(需要时可用 missing_path_behavior:'skip')。
 */
function defaultDenyReadPaths(): string[] {
  const home = homedir();
  const root = resolveProjectRoot();
  const candidates = [
    // 本项目与用户的凭据
    path.join(root, '.env'),
    path.join(root, '.env.local'),
    path.join(root, '.env.development'),
    // 沙箱自身的凭据文件(DPAPI 密文,仍不该让 agent 看见)
    path.join(sandboxHomePath(), '.sandbox-secrets'),
    path.join(home, '.codex'),
    // SSH / 云凭据
    path.join(home, '.ssh'),
    path.join(home, '.aws'),
    path.join(home, '.kube'),
    // 浏览器 cookie 与登录态
    path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
    path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
    path.join(home, 'AppData', 'Roaming', 'Mozilla', 'Firefox'),
  ].filter(p => existsSync(p));
  return [...new Set(candidates)].sort();
}

/**
 * 构造策略对象。这是**唯一策略真源** —— 各工具不再各自为政
 * (此前:workspace 靠 realpath 围栏、project_* 靠 safeJoin、xlsx_build 靠正则、
 *  execute_command 什么都没有)。
 */
export function buildPolicy(
  name: SandboxPolicyName,
  options: SandboxPolicyOptions = {},
  level: SandboxLevel = 'elevated',
): { profile: PermissionProfile; writeRoots: string[]; denyReadPaths: string[] } {
  const ws = workspaceRoot();
  const writeRoots: string[] = [];

  if (name !== 'readonly') {
    writeRoots.push(ws);
    writeRoots.push(...(options.extraWriteRoots ?? []));
  }

  // ⚠️ deny 条目只能给 elevated 档。restricted-token 后端启动前会检查
  // has_full_disk_read_access() = has_root_access(can_read) && !has_denied_read_restrictions()
  // (protocol/src/permissions.rs:873),profile 里带 deny 会让它返回 false,
  // 后端直接 bail「Restricted read-only access requires the elevated Windows sandbox backend」
  // ——即整个沙箱拒绝启动,而不是"deny 被忽略"。另一条路径
  // (sandboxing/src/windows.rs:124-129)同样以 refusing to run unsandboxed 拒绝。
  const supportsDenyRead = level === 'elevated';

  const denyReadPaths = supportsDenyRead
    ? [...defaultDenyReadPaths(), ...(options.extraDenyRead ?? [])]
        // 落在可写根内的 deny 会与 write 冲突,且实际用不到,直接剔除
        .filter(p => !writeRoots.some(root => p.toLowerCase().startsWith(root.toLowerCase())))
    : [];

  const entries: FileSystemEntry[] = [
    // 整盘可读:agent 需要读系统库、Python 运行时、项目源码。
    // 敏感路径由 deny 条目 + 显式 --deny-read-paths-json 挖洞。
    { path: { type: 'special', value: { kind: 'root' } }, access: 'read' },
    ...writeRoots.map<FileSystemEntry>(p => ({ path: { type: 'path', path: p }, access: 'write' })),
    ...denyReadPaths.map<FileSystemEntry>(p => ({ path: { type: 'path', path: p }, access: 'deny' })),
  ];

  return {
    profile: {
      type: 'managed',
      file_system: { type: 'restricted', entries },
      network: options.allowNetwork ? 'enabled' : 'restricted',
    },
    writeRoots,
    denyReadPaths,
  };
}

/**
 * 权限档位 → 策略放宽项。前端「完全访问权限」档走 'full'。
 *
 * ⚠️ **full 档不能用 `special:root` 作可写根** —— 实测(scripts/diag-tier-policy.mjs)
 * 沙箱会拒绝启动并报 `resolve permission profile token mode`。原因是上游
 * `permission_profile_supports_windows_restricted_token_sandbox` 的判据为
 * `!has_full_disk_write_access()`:整盘可写的策略被判定为沙箱无法承载。
 *
 * 实测可行的形状是**具体根目录**。这里取「项目所在盘符根 + 用户主目录」:
 * 覆盖真实越界场景(项目外目录、桌面、文档、下载),又**不含系统盘的 Windows /
 * Program Files** —— 即使用户选了完全访问,也不应让 agent 有能力破坏系统。
 */
export function tierPolicyOptions(tier: PermissionTier): SandboxPolicyOptions {
  if (tier !== 'full') return {};
  const projectDriveRoot = path.parse(resolveProjectRoot()).root; // 如 "E:\"
  const home = homedir();
  const roots = [projectDriveRoot, home].filter(p => p && existsSync(p));
  return {
    extraWriteRoots: [...new Set(roots)],
    allowNetwork: true,
  };
}

/**
 * 沙箱内子进程的环境变量。
 * **刻意最小化**:process.env 里有 LLM API key 等机密,整份透传等于把它们交给
 * 被沙箱限制的进程(deny-read 挡住了文件,却从环境变量漏出去就白做了)。
 * 需要额外变量的调用方显式传 extraEnv。
 */
function buildChildEnv(extraEnv?: Record<string, string>): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
    COMSPEC: process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
    TEMP: process.env.TEMP ?? '',
    TMP: process.env.TMP ?? '',
    // Windows 子进程 stdout 默认 GBK,Python 侧必须显式 UTF-8(M7 踩过)
    PYTHONIOENCODING: 'utf-8',
    ...extraEnv,
  };
}

// ---------------------------------------------------------------- argv 构造

export interface WrapperArgvOptions {
  /** 要在沙箱内执行的命令与参数(argv 形态,各元素独立,不做 shell 解析) */
  command: string;
  args?: string[];
  /** 子进程工作目录;默认 workspace 根 */
  cwd?: string;
  policy: SandboxPolicyName;
  policyOptions?: SandboxPolicyOptions;
  extraEnv?: Record<string, string>;
}

/**
 * 拼出完整 wrapper argv。调用方必须以**数组**形式交给 execFile/spawn 且
 * shell:false —— 策略 JSON 含引号与花括号,过 cmd.exe 拼串必炸。
 */
export function buildWrapperArgv(options: WrapperArgvOptions): { exe: string; argv: string[] } {
  const runtime = resolveSandboxRuntime();
  const cwd = options.cwd ?? workspaceRoot();
  const { profile, writeRoots, denyReadPaths } = buildPolicy(
    options.policy,
    options.policyOptions,
    runtime.level, // 必须传:restricted-token 档带 deny 条目会让沙箱拒绝启动
  );

  const argv = [
    '--run-as-windows-sandbox',
    '--codex-home', runtime.codexHome,
    '--command-cwd', cwd,
    '--permission-profile', JSON.stringify(profile),
    '--env-json', JSON.stringify(buildChildEnv(options.extraEnv)),
    '--windows-sandbox-level', runtime.level,
  ];

  // workspace-root 可多次出现;写根同时作为 workspace 根声明
  for (const root of writeRoots.length > 0 ? writeRoots : [cwd]) {
    argv.push('--workspace-root', root);
  }

  // ⚠️ deny-read 必须显式传参。Phase 0 实测:只在 permission-profile 的 entries
  // 里写 access:'deny' **不生效**(密钥被读出)。codex 自身调用链亦如此——
  // resolve_windows_elevated_filesystem_overrides 先从策略提取 deny 条目,
  // 再经独立参数交给 wrapper(sandboxing/src/windows.rs)。
  // 仅 elevated 档有效;restricted-token 档传了会被拒(该档无法强制读限制)。
  if (runtime.level === 'elevated' && denyReadPaths.length > 0) {
    argv.push('--deny-read-paths-json', JSON.stringify(denyReadPaths));
  }

  argv.push('--', options.command, ...(options.args ?? []));
  return { exe: runtime.exe, argv };
}

// ---------------------------------------------------------------- 输出解码与拒绝判定

/**
 * 中文 Windows 上 cmd.exe 的错误输出是 GBK,Python 是 UTF-8。
 * 先按 UTF-8 严格解码,失败才回退 GBK(合法 UTF-8 极少被误判)。
 */
export function decodeOutput(buf: Buffer | string | undefined): string {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  if (buf.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return buf.toString('latin1');
    }
  }
}

/** 命令自身失败(而非沙箱拒绝)的典型退出码,参考 codex sandboxing/src/denial.rs */
const NON_DENIAL_EXIT_CODES = new Set([2, 126, 127]);

const DENIAL_PATTERNS = [
  /PermissionError/i,
  /Errno 13/i,
  /Permission denied/i,
  /Access is denied/i,
  /拒绝访问/,
  /WinError 10013/i, // 网络被 WFP 拦
  /Operation not permitted/i,
  /read-only file system/i,
];

/**
 * 启发式判断"是否被沙箱拒绝"。
 * ⚠️ 这**无法做到确定性** —— codex 自己的 denial.rs 开头就承认:命令自身出错和
 * 沙箱拒绝无法可靠区分,它也是关键词匹配。因此不要用它做自动提权决策(误判会变成
 * 对用户的骚扰),只用于给 agent 生成可读的原因提示。
 */
export function isLikelySandboxDenial(exitCode: number | null, stderr: string): boolean {
  if (exitCode === 0 || exitCode === null) return false;
  if (NON_DENIAL_EXIT_CODES.has(exitCode)) return false;
  return DENIAL_PATTERNS.some(re => re.test(stderr));
}

// ---------------------------------------------------------------- 执行封装

export interface SandboxedExecOptions {
  cwd?: string;
  policy?: SandboxPolicyName;
  policyOptions?: SandboxPolicyOptions;
  timeout?: number;
  maxBuffer?: number;
  extraEnv?: Record<string, string>;
}

export interface SandboxedExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** 启发式:疑似被沙箱拒绝(见 isLikelySandboxDenial 的局限) */
  deniedBySandbox: boolean;
  timedOut: boolean;
}

/**
 * 在沙箱内执行 argv 形态的命令。与 promisify(execFile) 语义相近,
 * 三个 Python 工具(html_to_docx / html_to_pptx / xlsx_build)可直接替换。
 *
 * 注意:**不抛异常**表示命令失败 —— 返回 exitCode 与 deniedBySandbox 供调用方判断,
 * 这样工具能把"被沙箱拒绝"和"脚本自身报错"用不同措辞回给 agent。
 * 只有沙箱本身不可用(二进制缺失/未 setup)才抛错。
 */
/**
 * 沙箱内执行的核心包装:把 buildWrapperArgv 得到的 exe/argv 真正 spawn 出去,
 * 并统一做超时、输出解码、沙箱拒绝启发式判断。被 sandboxedExecFile 与
 * sandboxedShellExec 共用,避免错误处理复制粘贴。
 */
async function execWrapper(
  exe: string,
  argv: string[],
  options: SandboxedExecOptions,
): Promise<SandboxedExecResult> {
  const runtime = resolveSandboxRuntime();
  const baseTimeout = options.timeout ?? 60_000;
  const timeout =
    runtime.level === 'elevated' ? baseTimeout + ELEVATED_STARTUP_OVERHEAD_MS : baseTimeout;

  try {
    const { stdout, stderr } = await execFileAsync(exe, argv, {
      timeout,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
      windowsHide: true,
      encoding: 'buffer',
      // 不设 shell:数组参数直传,策略 JSON 不经 cmd.exe 拼串
    });
    return {
      stdout: decodeOutput(stdout),
      stderr: decodeOutput(stderr),
      exitCode: 0,
      deniedBySandbox: false,
      timedOut: false,
    };
  } catch (err) {
    const e = err as { code?: number | string; killed?: boolean; signal?: string; stdout?: Buffer; stderr?: Buffer; message?: string };
    const stdout = decodeOutput(e.stdout);
    const stderr = decodeOutput(e.stderr);
    const timedOut = e.killed === true || /ETIMEDOUT|timed? ?out/i.test(e.message ?? '');
    const exitCode = typeof e.code === 'number' ? e.code : 1;
    return {
      stdout,
      stderr: stderr || (e.message ?? ''),
      exitCode,
      deniedBySandbox: !timedOut && isLikelySandboxDenial(exitCode, stderr),
      timedOut,
    };
  }
}

/**
 * 在沙箱内执行 argv 形态的命令。与 promisify(execFile) 语义相近,
 * 三个 Python 工具(html_to_docx / html_to_pptx / xlsx_build)可直接替换。
 *
 * 注意:**不抛异常**表示命令失败 -- 返回 exitCode 与 deniedBySandbox 供调用方判断,
 * 这样工具能把"被沙箱拒绝"和"脚本自身报错"用不同措辞回给 agent。
 * 只有沙箱本身不可用(二进制缺失/未 setup)才抛错。
 */
export async function sandboxedExecFile(
  command: string,
  args: string[] = [],
  options: SandboxedExecOptions = {},
): Promise<SandboxedExecResult> {
  const { exe, argv } = buildWrapperArgv({
    command,
    args,
    cwd: options.cwd,
    policy: options.policy ?? 'workspace-write',
    policyOptions: options.policyOptions,
    extraEnv: options.extraEnv,
  });
  return execWrapper(exe, argv, options);
}

/**
 * 在沙箱内执行命令串形态(可能含 shell 操作符)的命令。
 * execute_command 因沙箱被拒后,提权工具需要按原命令串重跑,走此入口。
 */
export async function sandboxedShellExec(
  command: string,
  options: SandboxedExecOptions = {},
): Promise<SandboxedExecResult> {
  const { exe, argv } = buildShellWrapperArgv(command, {
    cwd: options.cwd,
    policy: options.policy ?? 'workspace-write',
    policyOptions: options.policyOptions,
    extraEnv: options.extraEnv,
  });
  return execWrapper(exe, argv, options);
}

// ---------------------------------------------------------------- 命令串承载(execute_command 用)

/** 命令串承载目录:位于写根内,两档均可读写 */
export function execScriptDir(): string {
  return path.join(workspaceRoot(), EXEC_SCRIPT_DIR_NAME);
}

/**
 * 清理超龄 .bat。
 * 为何用扫龄而非用完即删:Mastra 的 wrapCommandForIsolation 是**同步**的,
 * 拿不到进程结束时机;而在 spawn 外层包装又存在并发下的配对竞态。
 * 文件只有几百字节,扫龄清理简单且无竞态。
 */
export function sweepExecScripts(ttlMs = EXEC_SCRIPT_TTL_MS): void {
  const dir = execScriptDir();
  if (!existsSync(dir)) return;
  const cutoff = Date.now() - ttlMs;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.bat')) continue;
    const file = path.join(dir, name);
    try {
      if (statSync(file).mtimeMs < cutoff) rmSync(file, { force: true });
    } catch {
      // 正在被占用等情况忽略,下次再扫
    }
  }
}

/**
 * 把命令串写成 .bat 并返回路径。
 * `chcp 65001` 让中文路径与输出走 UTF-8;.bat 要求 CRLF 行尾。
 * shell 语法(重定向、&&、引号)全留在文件内,进程边界上只传一个无空格的路径。
 */
export function writeCommandScript(command: string): string {
  const dir = execScriptDir();
  mkdirSync(dir, { recursive: true });
  sweepExecScripts();
  const file = path.join(dir, `cmd-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}.bat`);
  writeFileSync(file, `@echo off\r\nchcp 65001>nul\r\n${command}\r\n`, 'utf8');
  return file;
}

/**
 * 把一条**命令串**(可能含 shell 操作符)包成 wrapper argv。
 * Mastra 的 execute_command 走这条路 —— 它给的是命令串而非 argv 数组。
 */
export function buildShellWrapperArgv(
  command: string,
  options: Omit<WrapperArgvOptions, 'command' | 'args'>,
): { exe: string; argv: string[] } {
  const scriptPath = writeCommandScript(command);
  return buildWrapperArgv({ ...options, command: 'cmd.exe', args: ['/c', scriptPath] });
}

// ---------------------------------------------------------------- 启动预检

/**
 * 启动预热:先付掉冷启动开销,避免用户的第一次请求承担它。
 *
 * 实测(scripts/diag-sandbox-perf.mjs 的结论,已录入 docs/spec/m11-plan.md):
 * 首次调用可达 16.5s,后续稳态 1.3–2.0s。差值来自访问控制项的首次应用,
 * 而这些项是**按凭据目录持久化**的,所以预热一次即可惠及后续所有调用。
 *
 * ⚠️ **必须与后续真实调用用同一策略**。拒读集合一变就要重写访问控制项(代价数秒),
 * 若预热用的集合与真实调用不同,等于白热一次、真实调用仍付全价。
 * 因此这里固定走 `workspace-write` + 默认拒读集合 —— 与三个 Python 工具和
 * CodexSandbox 的默认档一致。
 *
 * 不抛异常:预热失败不应阻塞启动,原因交由调用方写日志。
 */
export async function prewarmSandbox(): Promise<{ ok: boolean; elapsedMs: number; message: string }> {
  const startedAt = Date.now();
  try {
    // 最轻量的命令:只为触发一次完整的沙箱启动与访问控制项应用
    const result = await sandboxedExecFile('cmd.exe', ['/c', 'echo', 'warm'], {
      policy: 'workspace-write',
      timeout: 180_000, // 冷启动实测可达 16.5s,给足余量
    });
    const elapsedMs = Date.now() - startedAt;
    if (result.exitCode !== 0) {
      return {
        ok: false,
        elapsedMs,
        message: `沙箱预热未成功(退出码 ${result.exitCode},耗时 ${(elapsedMs / 1000).toFixed(1)}s): ${result.stderr.trim().split('\n').slice(-1)[0] || '无错误输出'}`,
      };
    }
    return {
      ok: true,
      elapsedMs,
      message: `沙箱预热完成,耗时 ${(elapsedMs / 1000).toFixed(1)}s(冷启动开销已付,后续调用走稳态)`,
    };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    return {
      ok: false,
      elapsedMs,
      message: `沙箱预热失败: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    };
  }
}

/**
 * 启动时自检:把沙箱不可用暴露在启动日志里,而不是等第一次工具调用才炸。
 * 返回可读状态;不抛异常(启动流程不应因此中断)。
 */
export function sandboxPreflight(): { ok: boolean; message: string } {
  try {
    const rt = resolveSandboxRuntime();
    const denyCount = defaultDenyReadPaths().length;
    return {
      ok: true,
      message:
        `沙箱就绪: ${rt.level} 档 | codex-home=${rt.codexHome} | ` +
        `拒读路径 ${denyCount} 条${rt.level === 'restricted-token' ? '(本档不生效)' : ''}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
