// Python 运行时定位(M7-T6)
// 开发态:mastra dev 的 cwd 是仓库根 → vendor/python/python.exe
// 打包态:app-desktop/main.js 注入 MEW_PYTHON_RUNTIME 指向 resources 内的运行时
// 两态共用同一套定位逻辑(N3):env 优先,cwd 兜底。
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveProjectRoot } from './project-root';

const execFileAsync = promisify(execFile);

export interface PythonRuntime {
  pythonExe: string;
  version: string;
}

/** 运行时缺失/损坏:错误信息必须指明尝试过的路径与修复办法(F9 可诊断)。 */
export class PythonRuntimeMissingError extends Error {
  readonly kind = 'runtime_missing';
}

async function probeVersion(pythonExe: string): Promise<string> {
  const { stdout } = await execFileAsync(pythonExe, ['--version'], {
    timeout: 10_000,
    windowsHide: true,
  });
  const m = /Python\s+(\S+)/.exec(stdout);
  if (!m) throw new Error(`无法解析版本输出: ${stdout.trim()}`);
  return m[1];
}

export async function resolvePythonRuntime(): Promise<PythonRuntime> {
  const candidates: string[] = [];
  if (process.env.MEW_PYTHON_RUNTIME) {
    candidates.push(process.env.MEW_PYTHON_RUNTIME);
  }
  // 项目根统一解析器(见 project-root.ts):各执行上下文 cwd 不一致,不能裸用 cwd
  candidates.push(path.join(resolveProjectRoot(), 'vendor', 'python', 'python.exe'));

  for (const pythonExe of candidates) {
    if (!existsSync(pythonExe)) continue;
    try {
      const version = await probeVersion(pythonExe);
      return { pythonExe, version };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new PythonRuntimeMissingError(
        `Python 运行时已损坏(无法执行): ${pythonExe}\n原因: ${reason}\n修复: 运行 node scripts/setup-python-runtime.mjs 重建运行时`,
      );
    }
  }
  throw new PythonRuntimeMissingError(
    `未找到 Python 运行时,尝试过: ${candidates.join(' , ')}\n修复: 运行 node scripts/setup-python-runtime.mjs 重建运行时(vendor/python/ 需存在且含 python.exe)`,
  );
}
