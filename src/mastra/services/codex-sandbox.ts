// 工作区沙箱(M11-T3):把 Mastra 工作区的命令执行送进 codex 沙箱
//
// 本类只做一件事:在框架起子进程的那一刻,把命令包一层沙箱前缀。
// 策略构造、argv 拼装、命令串落盘全在 sandbox-runtime.ts,这里不重复实现。
//
// ⚠️ 为何覆盖 wrapCommandForIsolation,而不是替换 processes:
//   MastraSandbox 构造器把 executeCommand 做成**闭包**,捕获的是传给 super() 的那个
//   进程管理器实例(见 @mastra/core workspace bundle 的 MastraSandbox 构造器:
//   `const pm = options.processes; this.processes = pm; if (!this.executeCommand)
//    this.executeCommand = async (...) => { ... pm.spawn(...) }`)。
//   而 LocalSandbox 构造器又在 spread 之后**硬写** `processes: new LocalProcessManager(...)`,
//   外部无法传入自己的实例。
//   若在 super() 之后替换 this.processes,只有后台 spawn 路径会走新实例,
//   前台 executeCommand 仍走闭包里那个**没有沙箱**的旧实例 —— 留下静默漏洞。
//   而 LocalProcessManager.spawn 每次都调 sandbox.wrapCommandForIsolation(),
//   它是前台与后台**共用的唯一包裹点**,覆盖一处即两条路径全覆盖(F2)。
import path from 'node:path';
import { LocalSandbox } from '@mastra/core/workspace';
import {
  buildShellWrapperArgv,
  tierPolicyOptions,
  type PermissionTier,
  type SandboxPolicyOptions,
} from './sandbox-runtime';
import { workspaceRoot } from './project-root';
import { currentPermissionTier, requestScope } from './request-scope';

/**
 * 隔离标记的哨兵值。
 *
 * 作用是让框架的 execa 调用走 `shell:false` —— bundle 里判的是
 * `shell: this.sandbox.isolation === "none"`,只要不等于 'none' 就是数组参数直传。
 * 这很关键:策略 JSON 含引号与花括号,过 cmd.exe 拼串必然被打烂。
 *
 * 不能用 'seatbelt':那会进 macOS 的配置文件分支(_prepareWorkspace 里会去写
 * seatbelt profile)。也不能在构造时就传这个值 —— Windows 上框架构造函数只接受
 * 'none',传其他值会抛 IsolationUnavailableError。故只能 super() 之后改写。
 */
const ISOLATION_TAG = 'codex-windows';

export interface CodexSandboxOptions {
  /** 工作目录,同时作为默认可写根 */
  workingDirectory: string;
  /** 额外可写根(绝对路径),如当前项目目录 */
  extraWriteRoots?: string[];
  /**
   * 解析当次调用的权限档位。返回 'full' 时策略放宽(见 tierPolicyOptions)。
   *
   * ⚠️ 并发陷阱(留给 T15 处理):档位来自 requestContext,是**每请求**不同的;
   * 而本类在模块加载时只构造一次,wrapCommandForIsolation 又只收到命令串,
   * 拿不到请求上下文。因此这个回调**不能实现为读一个模块级全局变量** ——
   * 两个并发请求档位不同时会互相串档,低档请求可能拿到高档权限。
   * 正确做法需要请求作用域的存储(如 AsyncLocalStorage 或按 threadId 索引)。
   * 未提供该回调时按 'default' 档处理(fail-closed)。
   */
  resolveTier?: () => PermissionTier;
}

export class CodexSandbox extends LocalSandbox {
  private readonly _extraWriteRoots: string[];
  private readonly _resolveTier?: () => PermissionTier;

  constructor(options: CodexSandboxOptions) {
    // 传 'none' 让框架构造校验通过(Windows 上无可用原生后端)
    super({ workingDirectory: options.workingDirectory, isolation: 'none' });

    // ⚠️ 工作目录必须落成绝对路径。
    // agent.ts 传的是相对路径 'workspace',框架原样保留(只做 ~ 展开),
    // 而沙箱 wrapper 的 --command-cwd 要求绝对路径,收到相对路径会直接报错。
    // 用 workspaceRoot() 兜底 —— 它是项目统一的绝对路径解析器,与相对路径
    // 'workspace' 的实际落点一致(见 project-root.ts:各执行上下文 cwd 不一致,
    // 不能裸用 process.cwd())。
    // 写回父类而非只存私有字段:框架的进程管理器也用 sandbox.workingDirectory
    // 作 execa 的 cwd,两处必须一致(setWorkingDirectory 正是为此开放给子类的)。
    if (!path.isAbsolute(this.workingDirectory)) {
      this.setWorkingDirectory(workspaceRoot());
    }

    this._extraWriteRoots = options.extraWriteRoots ?? [];
    this._resolveTier = options.resolveTier;

    // super() 之后改写:isolation 是普通类字段,此时赋值不再经过构造校验。
    // 类型上框架只声明了自己支持的后端名,这里的哨兵值需要断言。
    (this as unknown as { isolation: string }).isolation = ISOLATION_TAG;
  }

  /** 依当次档位算出策略放宽项;未配置解析器时按默认档(不放宽) */
  private currentPolicyOptions(): SandboxPolicyOptions {
    // T15:优先使用构造参数(向后兼容),否则从请求作用域读取档位。
    const tier: PermissionTier = this._resolveTier?.() ?? currentPermissionTier();
    const tierOptions = tierPolicyOptions(tier);
    return {
      ...tierOptions,
      extraWriteRoots: [...this._extraWriteRoots, ...(tierOptions.extraWriteRoots ?? [])],
    };
  }

  /**
   * 框架的 LocalProcessManager.spawn 每次起进程都会调这里,是唯一的命令包裹点。
   *
   * 收到的是一条**命令串**(可能含重定向、逻辑与等 shell 语法),不是 argv 数组,
   * 所以走 buildShellWrapperArgv —— 它把命令串落成 .bat 再交给沙箱。
   * 直接把命令串当单个 argv 元素交给 cmd.exe /c 是不行的:cmd.exe 不遵循 CRT
   * argv 引号规则,三层转义后引号会变字面量,报「文件名、目录名或卷标语法不正确」
   * (那是语法错误,却极易被误读成权限拒绝)。
   */
  wrapCommandForIsolation(command: string): { command: string; args: string[] } {
    const { exe, argv } = buildShellWrapperArgv(command, {
      cwd: this.workingDirectory,
      policy: 'workspace-write',
      policyOptions: this.currentPolicyOptions(),
    });
    return { command: exe, args: argv };
  }
}
