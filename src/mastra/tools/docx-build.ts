// docx.js 受控建文档工具(Word 生成改版:HTML→Python 转换器 → agent 直写 docx.js 脚本)
// agent 按 docx 技能写好 docx.js(npm)脚本后调用本工具,工具负责落盘、在沙箱内执行、校验产物。
// 与 xlsx_build(openpyxl)同源同构,这里换成 Node/docx.js:脚本通过 process.argv[2] 拿到
// 输出绝对路径,自行 require('docx') 拼文档并 Packer.toBuffer 写盘。
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { workspaceRoot } from '../services/project-root';
import { sandboxedExecFile, type SandboxedExecResult } from '../services/sandbox-runtime';

// 常规长度文档构建应秒级完成;60s 兜底防挂死(同 xlsx_build/html_to_docx 的量级)
const BUILD_TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 10 * 1024 * 1024;

function getWorkspaceRoot(): string {
  return workspaceRoot();
}

// 输出路径必须落在 workspace 根内(防穿越,与 html-to-docx.ts/xlsx-build.ts 同款校验)
function safeOutputPath(outputPath: string): string | null {
  const root = workspaceRoot();
  const abs = path.isAbsolute(outputPath)
    ? path.normalize(outputPath)
    : path.resolve(root, outputPath);
  const rootNorm = root.toLowerCase();
  if (!abs.toLowerCase().startsWith(rootNorm + path.sep)) return null;
  return abs;
}

// 根据目标 docx 路径生成隐藏工作目录 .<基名>.ref/(同 xlsx_build 的 refDirFor 命名规则)
function refDirFor(absOutput: string): string {
  const root = workspaceRoot();
  const base = path.basename(absOutput, path.extname(absOutput)) || 'document';
  return path.join(root, `.${base}.ref`);
}

export const docxBuildTool = createTool({
  id: 'docx_build',
  description:
    '执行 agent 编写的 docx(npm,docx.js)建文档脚本,生成 .docx。' +
    '输入:完整 CommonJS 脚本文本(脚本应 require("docx"),通过 process.argv[2] 获取输出绝对路径,' +
    '用 Packer.toBuffer(doc) 得到 Buffer 后 fs.writeFileSync(outPath, buf) 写盘),' +
    '以及相对于 workspace 根的产物路径(如 报告/项目介绍.docx)。' +
    '脚本在受限环境中执行:只能读写 workspace 目录内的路径,不能访问外部目录、读取凭据文件或联网' +
    '(因此也无法 npm install,只能 require 预装库如 docx)。' +
    '若 clean 为 true,则只清理对应 .ref 工作目录并返回。',
  inputSchema: z.object({
    buildScript: z
      .string()
      .default('')
      .describe('完整 docx.js 建文档脚本(CommonJS),通过 process.argv[2] 获得产物绝对路径;clean 模式可为空'),
    docxPath: z
      .string()
      .min(1)
      .describe('产物 .docx 路径,相对 workspace 根目录,如 报告/项目介绍.docx'),
    clean: z
      .boolean()
      .optional()
      .describe('为 true 时清理本产物对应的 .ref 工作目录,不执行构建'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    docxPath: z.string().optional(),
    cleaned: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ buildScript, docxPath, clean }) => {
    // 1. 输出路径校验(防穿越)
    const absOutput = safeOutputPath(docxPath);
    if (!absOutput) {
      return { ok: false, error: `非法输出路径: ${docxPath}(必须位于 workspace 根目录内)` };
    }

    const refDir = refDirFor(absOutput);

    // 1.5 clean 模式外必须提供脚本
    if (!clean && !buildScript.trim()) {
      return { ok: false, error: '缺少 buildScript' };
    }

    // 2. clean 模式:直接删除 .ref 目录
    if (clean) {
      await rm(refDir, { recursive: true, force: true });
      return { ok: true, docxPath, cleaned: true };
    }

    // 3. 写 build.cjs 到 .ref 目录(项目 "type": "module",脚本须用 .cjs 后缀
    //    才能走 CommonJS/require,否则 Node 会当 ESM 解析导致 require 报错)
    await mkdir(refDir, { recursive: true });
    await mkdir(path.dirname(absOutput), { recursive: true });
    const buildCjs = path.join(refDir, 'build.cjs');
    await writeFile(buildCjs, buildScript, 'utf-8');

    // 4. 在沙箱内以当前 Node 可执行文件执行脚本
    let build: SandboxedExecResult;
    try {
      build = await sandboxedExecFile(process.execPath, [buildCjs, absOutput], {
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
      return { ok: false, error: `建文档脚本执行超时(>${BUILD_TIMEOUT_MS / 1000}s):请简化脚本后重试` };
    }
    if (build.exitCode !== 0) {
      // Node 未捕获异常把关键信息(抛出位置 + "Error: 消息")放在开头,末尾是一堆
      // 通用的模块加载器堆栈帧、外加 "Node.js vX.X.X" 版本行——取尾部反而丢了有用信息
      // (Python traceback 摘要在最后一行,取尾合适;Node 刚好相反)。
      const lines = (build.stderr || build.stdout).trim().split('\n');
      if (lines.length > 0 && /^Node\.js v/.test(lines[lines.length - 1])) lines.pop();
      const detail = lines.slice(0, 12).join('\n');
      // 区分「被沙箱拒绝」与「脚本自身报错」,让 agent 知道该改路径还是改逻辑
      if (build.deniedBySandbox) {
        return {
          ok: false,
          error:
            `建文档脚本被沙箱拒绝:脚本只能读写 workspace 目录内的路径,不能访问外部目录、` +
            `读取凭据文件或联网。请把产物与中间文件都放在 workspace 内后重试。\n${detail}`,
        };
      }
      return { ok: false, error: `建文档脚本执行失败:\n${detail}` };
    }

    // 5. 确认产物确实落盘(脚本可能 exit 0 但忘了写文件)
    try {
      const info = await stat(absOutput);
      if (!info.isFile() || info.size === 0) {
        return { ok: false, error: `脚本执行完成但未生成有效产物: ${docxPath}` };
      }
    } catch {
      return { ok: false, error: `脚本执行完成但产物文件不存在: ${docxPath}(检查脚本是否正确写入 process.argv[2] 指定的路径)` };
    }

    return { ok: true, docxPath };
  },
});
