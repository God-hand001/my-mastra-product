// 项目根定位(M10 review 发现的统一问题)
// mastra dev 各执行上下文的 process.cwd() 不一致:
//   - apiRoutes 上下文 cwd = src/mastra/public(实测)
//   - 工具执行上下文 cwd 观测为仓库根(M7 E2E vendor/python 命中)
// 因此任何"项目根相对路径"禁止直接 path.resolve(cwd, …),统一走本解析器:
// 从 cwd 逐级向上找同时含 package.json 与 src/mastra 的目录(即仓库根)。
import fs from 'node:fs';
import path from 'node:path';

let cached: string | null = null;

export function resolveProjectRoot(): string {
  if (cached) return cached;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'src', 'mastra'))) {
      cached = dir;
      return cached;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // 到盘符根了
    dir = parent;
  }
  cached = process.cwd(); // 兜底:找不到标记时退回 cwd(至少行为与旧实现一致)
  return cached;
}

/** workspace 根:产物与连接器 ${ROOT} 的基准(与 Mastra workspace basePath 'workspace' 的实际落点一致) */
export function workspaceRoot(): string {
  return path.join(resolveProjectRoot(), 'src', 'mastra', 'public', 'workspace');
}
