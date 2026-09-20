// HTML → .docx 转换工具(M7-T6)
// agent 写完整 HTML 后调用本工具一次产出 .docx(F7);失败返回结构化原因供 agent 修正重试。
// 转换器本体在 src/mastra/tools/html_to_docx/(Python 包,随 vendor/python 运行时分发)。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PythonRuntimeMissingError, resolvePythonRuntime } from '../services/python-runtime';
import { workspaceRoot } from '../services/project-root';
import { sandboxedExecFile, type SandboxedExecResult } from '../services/sandbox-runtime';

// 常规长度文档转换应秒级完成(N4);60s 兜底防挂死
const CONVERT_TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 10 * 1024 * 1024;

// 结果契约的错误类别(Python 侧 errors.py)→ 给 agent 看的中文类别
const KIND_LABELS: Record<string, string> = {
  html_parse: 'HTML 解析失败',
  unsupported_style: '样式不支持',
  write_failed: '写文件失败',
  runtime_missing: 'Python 运行时缺失',
  internal: '转换器内部错误',
};

// 与 agent.ts 的 workspacePath 一致:产物相对 workspace 根(产物标记约定同源)
// 使用统一项目根解析器——工具执行上下文的 cwd 不可靠(见 project-root.ts 注释)
function getWorkspaceRoot(): string {
  return workspaceRoot();
}

// outputPath 必须落在 workspace 根内(防穿越,参考 project-tools 的 safeJoin)
function safeOutputPath(outputPath: string): string | null {
  const root = workspaceRoot();
  const abs = path.isAbsolute(outputPath)
    ? path.normalize(outputPath)
    : path.resolve(root, outputPath);
  const rootNorm = root.toLowerCase();
  if (!abs.toLowerCase().startsWith(rootNorm + path.sep)) return null;
  return abs;
}

interface ConverterResult {
  ok: boolean;
  outputPath?: string;
  warnings?: Array<{ kind: string; [k: string]: unknown }>;
  error?: { kind: string; message: string; detail?: string };
}

// CLI 约定 stdout 只有一行 JSON;取最后一行能解析成对象的行,兼容极端情况下的杂散输出
function parseResultJson(stdout: string): ConverterResult | null {
  for (const line of stdout.trimEnd().split('\n').reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      return JSON.parse(t) as ConverterResult;
    } catch {
      // 继续往前找
    }
  }
  return null;
}

export async function convertHtmlToDocx(html: string, outputPath: string) {
    // 1. 运行时定位(F9:缺失要给出明确缺失项与修复办法)
    let pythonExe: string;
    try {
      const runtime = await resolvePythonRuntime();
      pythonExe = runtime.pythonExe;
    } catch (err) {
      if (err instanceof PythonRuntimeMissingError) {
        return { success: false, error: err.message };
      }
      throw err;
    }

    // 2. 输出路径校验(防穿越)+ 输出目录预创建(比 Python 侧报错更早、更清晰)
    const absOutput = safeOutputPath(outputPath);
    if (!absOutput) {
      return { success: false, error: `非法输出路径: ${outputPath}(必须位于 workspace 根目录内)` };
    }
    await mkdir(path.dirname(absOutput), { recursive: true });

    // 3. 任务 JSON 落临时目录(HTML 可达数十 KB,不能走命令行参数)
    // M11:任务目录从系统临时目录挪进 workspace 内 —— 转换器现在以受限身份运行,
    // 写不进当前用户的 TEMP。点前缀目录已被 workspace-routes 的产物扫描过滤。
    let taskDir: string | null = null;
    try {
      const convertBase = path.join(workspaceRoot(), '.mew-convert');
      await mkdir(convertBase, { recursive: true });
      taskDir = await mkdtemp(path.join(convertBase, 'html2docx-'));
      const taskFile = path.join(taskDir, 'task.json');
      await writeFile(taskFile, JSON.stringify({ html, outputPath: absOutput }), 'utf-8');

      // 4. 在沙箱内调用转换器
      const run: SandboxedExecResult = await sandboxedExecFile(
        pythonExe,
        ['-m', 'html_to_docx', '--input', taskFile],
        {
          policy: 'workspace-write',
          timeout: CONVERT_TIMEOUT_MS,
          maxBuffer: MAX_STDOUT_BYTES,
        },
      );

      // CLI 失败时也会打印契约 JSON(退出码 1),故先尝试解析,再按超时/拒绝/其他分流
      const parsed = parseResultJson(run.stdout);
      if (parsed) {
        return toToolOutput(parsed, outputPath);
      }
      if (run.timedOut) {
        return { success: false, error: `转换超时(>${CONVERT_TIMEOUT_MS / 1000}s):任务中断,请简化文档后重试` };
      }
      const detail = (run.stderr || run.stdout).trim().split('\n').slice(-6).join('\n');
      if (run.deniedBySandbox) {
        return {
          success: false,
          error:
            `转换被沙箱拒绝:输出路径必须位于 workspace 目录内,且 HTML 引用的本地图片也需在其中。\n${detail}`,
        };
      }
      return {
        success: false,
        error: `转换器没有返回有效结果: ${detail || `退出码 ${run.exitCode}`}`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { success: false, error: `转换过程异常: ${reason}` };
    } finally {
      if (taskDir) await rm(taskDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

export const htmlToDocxTool = createTool({
  id: 'html_to_docx',
  description:
    'Convert a complete HTML document into a .docx Word file. Input: full HTML string and an output path relative to the workspace root. ' +
    'MANDATORY HTML skeleton (follow it exactly, adjust content only):\n' +
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">\n' +
    '<meta name="doc-footer" content="第 {{page}} 页 / 共 {{pages}} 页">\n' +
    '<style>@page { size: A4; } body { font-family: "宋体", serif; }</style></head><body>\n' +
    '<section><h1>第一章标题</h1><p>内容…</p></section>\n' +
    '<section><nav data-toc>目录</nav><h1>第二章标题</h1><p>内容…</p></section>\n' +
    '</body></html>\n' +
    'Rules: every chapter MUST be wrapped in <section>…</section> (each starts on a new page); ' +
    'place <nav data-toc>目录</nav> where the TOC should appear; ' +
    'header/footer via <meta name="doc-header"/"doc-footer"> with {{page}}/{{pages}}; ' +
    'Chinese font via body { font-family: "宋体" }; ' +
    'tables use table/th/td with border/width/background; ' +
    'images use <img src="local path | data: | https://…" width="…">; ' +
    'callouts use <div class="callout" data-type="info|success|warning|danger">; ' +
    'stat cards use <div class="stat-cards"><div class="stat-card"><div class="stat-title">…</div><div class="stat-value">…</div></div></div>. ' +
    'Returns the output path and warnings; on failure returns a readable reason to fix the HTML.',
  inputSchema: z.object({
    html: z.string().min(1).describe('完整 HTML 文档(含 head/body),遵循 M7 HTML 约定'),
    outputPath: z
      .string()
      .min(1)
      .describe('输出 .docx 路径,相对 workspace 根目录,如 报告/项目周报.docx'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    outputPath: z.string().optional(),
    warnings: z
      .array(z.object({ kind: z.string() }).passthrough().optional())
      .optional()
      .nullable(),
    error: z.string().optional(),
  }),
  execute: async ({ html, outputPath }) => convertHtmlToDocx(html, outputPath),
});

function toToolOutput(result: ConverterResult, requestedPath: string) {
  if (result.ok) {
    return {
      success: true,
      outputPath: result.outputPath ?? requestedPath,
      warnings: result.warnings ?? [],
    };
  }
  const err = result.error ?? { kind: 'internal', message: '未知错误' };
  const label = KIND_LABELS[err.kind] ?? '转换失败';
  const detail = err.detail ? `\n细节: ${err.detail}` : '';
  return {
    success: false,
    error: `[${label}] ${err.message}${detail}`,
  };
}
