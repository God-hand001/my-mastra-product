// xlsx 受控建表工具(M9)
// agent 按 excel-generation 技能写好 openpyxl 脚本后调用本工具,工具负责落盘、执行、重算校验。
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PythonRuntimeMissingError, resolvePythonRuntime } from '../services/python-runtime';
import { workspaceRoot } from '../services/project-root';
import { sandboxedExecFile, type SandboxedExecResult } from '../services/sandbox-runtime';

// 常规建表脚本应秒级完成;60s 兜底
const BUILD_TIMEOUT_MS = 60_000;
const RECALC_TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 10 * 1024 * 1024;

// M11:此处原有一份「脚本内容黑名单」(正则匹配 pip install / subprocess / os.system /
// eval( / exec( 共 5 条)已移除 —— 它只做字符串匹配,拦不住 open() 直接写文件、
// __import__、importlib、getattr 拼接、shutil、socket 等等价手段,属于给人虚假安全感的防线。
// 现在脚本在受限身份的沙箱内执行,越界读写由内核访问检查拒绝(见 services/sandbox-runtime.ts)。

function getWorkspaceRoot(): string {
  return workspaceRoot();
}

// 输出路径必须落在 workspace 根内(防穿越)
function safeOutputPath(outputPath: string): string | null {
  const root = workspaceRoot();
  const abs = path.isAbsolute(outputPath)
    ? path.normalize(outputPath)
    : path.resolve(root, outputPath);
  const rootNorm = root.toLowerCase();
  if (!abs.toLowerCase().startsWith(rootNorm + path.sep)) return null;
  return abs;
}

// 根据目标 xlsx 路径生成隐藏工作目录 .<基名>.ref/
function refDirFor(absOutput: string): string {
  const root = workspaceRoot();
  const base = path.basename(absOutput, path.extname(absOutput)) || 'workbook';
  return path.join(root, `.${base}.ref`);
}

// 解析 recalc CLI 的最后一行 JSON
function parseRecalcJson(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.trimEnd().split('\n').reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      // 继续往前找
    }
  }
  return null;
}

export const xlsxBuildTool = createTool({
  id: 'xlsx_build',
  description:
    '执行 agent 编写的 openpyxl 建表脚本,生成 .xlsx 并自动重算校验。' +
    '输入:完整 Python 脚本文本(脚本应通过 sys.argv[1] 获取输出路径并 wb.save(sys.argv[1])),' +
    '以及相对于 workspace 根的产物路径(如 报表/月度开支.xlsx)。' +
    '脚本在受限环境中执行:只能读写 workspace 目录内的路径,不能访问外部目录、读取凭据文件或联网' +
    '(因此也无法 pip install,只能 import 预装库如 openpyxl/formulas)。' +
    '若 clean 为 true,则只清理对应 .ref 工作目录并返回。',
  inputSchema: z.object({
    buildScript: z
      .string()
      .default('')
      .describe('完整 openpyxl 建表脚本,通过 sys.argv[1] 获得产物绝对路径;clean 模式可为空'),
    xlsxPath: z
      .string()
      .min(1)
      .describe('产物 .xlsx 路径,相对 workspace 根目录,如 报表/月度开支.xlsx'),
    clean: z
      .boolean()
      .optional()
      .describe('为 true 时清理本产物对应的 .ref 工作目录,不执行构建'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    xlsxPath: z.string().optional(),
    cleaned: z.boolean().optional(),
    recalc: z
      .object({
        engine: z.string().optional(),
        status: z.string().optional(),
        totalErrors: z.number().optional(),
        errorSummary: z.array(z.object({ cell: z.string(), kind: z.string() })).optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ buildScript, xlsxPath, clean }) => {
    // 1. 运行时定位
    let pythonExe: string;
    try {
      const runtime = await resolvePythonRuntime();
      pythonExe = runtime.pythonExe;
    } catch (err) {
      if (err instanceof PythonRuntimeMissingError) {
        return { ok: false, error: err.message };
      }
      throw err;
    }

    // 2. 输出路径校验(防穿越)
    const absOutput = safeOutputPath(xlsxPath);
    if (!absOutput) {
      return { ok: false, error: `非法输出路径: ${xlsxPath}(必须位于 workspace 根目录内)` };
    }

    const refDir = refDirFor(absOutput);

    // 2.5 clean 模式外必须提供脚本
    if (!clean && !buildScript.trim()) {
      return { ok: false, error: '缺少 buildScript' };
    }

    // 3. clean 模式:直接删除 .ref 目录
    if (clean) {
      await rm(refDir, { recursive: true, force: true });
      return { ok: true, xlsxPath, cleaned: true };
    }

    // 4. 写 build.py 到 .ref 目录,预创建产物目录,在沙箱内执行脚本
    await mkdir(refDir, { recursive: true });
    await mkdir(path.dirname(absOutput), { recursive: true });
    const buildPy = path.join(refDir, 'build.py');
    await writeFile(buildPy, buildScript, 'utf-8');

    let build: SandboxedExecResult;
    try {
      build = await sandboxedExecFile(pythonExe, [buildPy, absOutput], {
        cwd: refDir,
        policy: 'workspace-write',
        timeout: BUILD_TIMEOUT_MS,
        maxBuffer: MAX_STDOUT_BYTES,
      });
    } catch (err) {
      // 沙箱本身不可用(二进制缺失/未完成初始化):fail-closed,不退回无防护执行
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (build.timedOut) {
      return { ok: false, error: `建表脚本执行超时(>${BUILD_TIMEOUT_MS / 1000}s):请简化脚本后重试` };
    }
    if (build.exitCode !== 0) {
      const detail = (build.stderr || build.stdout).trim().split('\n').slice(-8).join('\n');
      // 区分「被沙箱拒绝」与「脚本自身报错」,让 agent 知道该改路径还是改逻辑
      if (build.deniedBySandbox) {
        return {
          ok: false,
          error:
            `建表脚本被沙箱拒绝:脚本只能读写 workspace 目录内的路径,不能访问外部目录、` +
            `读取凭据文件或联网。请把产物与中间文件都放在 workspace 内后重试。\n${detail}`,
        };
      }
      return { ok: false, error: `建表脚本执行失败:\n${detail}` };
    }

    // 5. 确认产物存在
    // 输出目录已在执行前创建,此处仅作为防御性兜底

    // 6. 自动重算校验
    let recalcRun: SandboxedExecResult;
    try {
      recalcRun = await sandboxedExecFile(
        pythonExe,
        ['-m', 'xlsx_recalc', absOutput, String(RECALC_TIMEOUT_MS / 1000)],
        {
          policy: 'workspace-write',
          timeout: RECALC_TIMEOUT_MS + 5_000, // 给进程启动留余量
          maxBuffer: MAX_STDOUT_BYTES,
        },
      );
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), xlsxPath };
    }

    const recalcStdout = recalcRun.stdout;
    // 判定纪律:优先读 stdout 里的 status(见第 7 步),只有拿不到 JSON 时才看退出码/超时。
    // 重算引擎在发现公式错误时也可能非零退出,但那种情况下 JSON 里有可用的错误定位。
    const recalc = parseRecalcJson(recalcStdout);
    if (!recalc) {
      if (recalcRun.timedOut) {
        return {
          ok: false,
          error: `公式重算超时(>${RECALC_TIMEOUT_MS / 1000}s):请检查公式复杂度或循环引用`,
          xlsxPath,
        };
      }
      const detail = (recalcRun.stderr || recalcStdout).trim().split('\n').slice(-6).join('\n');
      return {
        ok: false,
        error: recalcRun.deniedBySandbox
          ? `公式重算被沙箱拒绝(产物需位于 workspace 内):\n${detail}`
          : `公式重算未返回有效 JSON: ${detail || `退出码 ${recalcRun.exitCode}`}`,
        xlsxPath,
      };
    }

    // 7. 组装结果:判定纪律——读 status,不看退出码
    const status = recalc.status;
    if (status === 'success') {
      return {
        ok: true,
        xlsxPath,
        recalc: {
          engine: String(recalc.engine ?? 'formulas'),
          status: 'success',
          totalErrors: Number(recalc.totalErrors ?? 0),
        },
      };
    }

    if (status === 'errors_found') {
      const summary = Array.isArray(recalc.errorSummary)
        ? recalc.errorSummary.map((e: any) => ({ cell: String(e.cell), kind: String(e.kind) }))
        : [];
      return {
        ok: false,
        error: `公式校验发现 ${recalc.totalErrors ?? summary.length} 个错误,请按以下定位修正后重试:\n` +
          summary.map(s => `- ${s.cell}: ${s.kind}`).join('\n'),
        xlsxPath,
        recalc: {
          engine: String(recalc.engine ?? 'formulas'),
          status: 'errors_found',
          totalErrors: Number(recalc.totalErrors ?? summary.length),
          errorSummary: summary,
        },
      };
    }

    // status === 'error' 或未知
    return {
      ok: false,
      error: `公式重算引擎异常: ${recalc.message || JSON.stringify(recalc)}`,
      xlsxPath,
      recalc: {
        engine: String(recalc.engine ?? 'formulas'),
        status: String(status ?? 'error'),
        totalErrors: Number(recalc.totalErrors ?? 0),
      },
    };
  },
});
