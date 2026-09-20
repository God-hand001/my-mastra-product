// HTML → .pptx 转换工具(M8-T4)
// agent 写完整 HTML 后调用本工具一次产出 .pptx(F7);失败返回结构化原因供 agent 修正重试。
// 转换器本体在 src/mastra/tools/html_to_pptx/(Python 包,随 vendor/python 运行时分发)。
// 本文件由 html-to-docx.ts 同源改造而来。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PythonRuntimeMissingError, resolvePythonRuntime } from '../services/python-runtime';
import { workspaceRoot } from '../services/project-root';
import { sandboxedExecFile, type SandboxedExecResult } from '../services/sandbox-runtime';

// 常规长度 PPT 转换应秒级完成(N4);60s 兜底防挂死
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
  warnings?: Array<{ kind: string; [key: string]: unknown }>;
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

export async function convertHtmlToPptx(html: string, outputPath: string) {
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

    // 2. 输出路径校验(防穿越)+ 输出目录预创建
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
      taskDir = await mkdtemp(path.join(convertBase, 'html2pptx-'));
      const taskFile = path.join(taskDir, 'task.json');
      await writeFile(taskFile, JSON.stringify({ html, outputPath: absOutput }), 'utf-8');

      // 4. 在沙箱内调用转换器
      const run: SandboxedExecResult = await sandboxedExecFile(
        pythonExe,
        ['-m', 'html_to_pptx', '--input', taskFile],
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
        return { success: false, error: `转换超时(>${CONVERT_TIMEOUT_MS / 1000}s):任务中断,请简化 PPT 后重试` };
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

export const htmlToPptxTool = createTool({
  id: 'html_to_pptx',
  description:
    'Convert a complete HTML document into a .pptx PowerPoint file. Input: full HTML string and an output path relative to the workspace root. ' +
    'MANDATORY HTML skeleton (follow it exactly, adjust content only):\n' +
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">\n' +
    '<style>@page { size: 1280px 720px; } body { font-family: "微软雅黑", sans-serif; }</style></head><body>\n' +
    '<section data-layout="title"><h1>封面大标题</h1><p>副标题</p></section>\n' +
    '<section data-layout="content"><h1>页面标题</h1><h2>小节标题</h2><p>正文…</p><ul><li>要点</li></ul></section>\n' +
    '<section data-layout="two-col"><h1>两栏标题</h1><div class="col-left"><p>左栏…</p></div><div class="col-right"><p><img src="…" width="200px"></p></div></section>\n' +
    '<section data-layout="content"><h1>数据页</h1>\n' +
    '<div class="stat-cards"><div class="stat-card"><div class="stat-title">指标</div><div class="stat-value">99%</div></div></div>\n' +
    '<div class="callout" data-type="info|success|warning|danger"><p>提示文本</p></div>\n' +
    '<hr><p><img src="local path | data: | https://…" width="150px"></p></section>\n' +
    '</body></html>\n' +
    'Rules: every slide MUST be a top-level <section>…</section>; use data-layout to pick title|content|two-col|image-full; ' +
    'page title via h1; headings h2/h3 and lists up to 2 levels; inline styles (strong/em/u/span color/font-size); ' +
    'Chinese font via body { font-family: "微软雅黑" }; ' +
    'images use <img src="local path | data: | https://…" width="…"> (a single 404 gives a placeholder + warning); ' +
    'stat cards use <div class="stat-cards"><div class="stat-card"><div class="stat-title">…</div><div class="stat-value">…</div></div></div>; ' +
    'callouts use <div class="callout" data-type="info|success|warning|danger"><p>…</p></div>; ' +
    'hr becomes a horizontal line. Returns the output path and warnings; on failure returns a readable reason to fix the HTML.',
  inputSchema: z.object({
    html: z.string().min(1).describe('完整 HTML 文档(含 head/body),遵循 M8 HTML 约定'),
    outputPath: z
      .string()
      .min(1)
      .describe('输出 .pptx 路径,相对 workspace 根目录,如 汇报/项目介绍.pptx'),
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
  execute: async ({ html, outputPath }) => convertHtmlToPptx(html, outputPath),
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
