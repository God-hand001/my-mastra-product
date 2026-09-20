import { registerApiRoute } from '@mastra/core/server';
import { exec, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { convertHtmlToDocx } from '../tools/html-to-docx';
import { convertHtmlToPptx } from '../tools/html-to-pptx';

// 工作空间文件路由(H0:对话栏选择工作空间文件作为上下文)
// 产物本机操作端点,边界校验与既有端点一致(N2)
// 工作区 = mastra basePath 'workspace'(即 src/mastra/public/workspace/)
// agent 的 workspace 工具也绑定此目录
const WORKSPACE_ROOT = path.resolve('workspace');

// 直接 spawn 可执行文件(不经过 cmd.exe /c 拼字符串)。
// 原实现走 `cmd.exe /c "start \"\" \"...\""`:Node 在 Windows 上对参数里的引号按
// C 运行时约定转义(变成 \"),cmd.exe 并不认这种转义,命令被打烂导致程序根本没起来;
// 而且原来的 resolve() 是同步调用的,在 spawn 的 error 事件触发前就已经 resolve,
// 任何启动失败都被吞掉,前端永远收到 {ok:true}(2026-09-18 用户反馈"点击没反应")。
// 直接传参数数组给 spawn 不经过 shell,天然没有引号转义问题;并等 spawn/error 事件
// 而不是提前 resolve,失败才能真正冒泡给前端。
function spawnDetached(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

// 命令行字符串 → [exe, ...args],识别双引号包裹的片段(常见于注册表里的
// `"C:\...\app.exe" "%1"` 形式);无 shell 参与,纯字符串切分。
function parseCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = command.length;
  while (i < n) {
    while (i < n && command[i] === ' ') i++;
    if (i >= n) break;
    if (command[i] === '"') {
      i++;
      let buf = '';
      while (i < n && command[i] !== '"') {
        buf += command[i];
        i++;
      }
      i++; // 跳过闭合引号
      tokens.push(buf);
    } else {
      const start = i;
      while (i < n && command[i] !== ' ') i++;
      tokens.push(command.slice(start, i));
    }
  }
  return tokens;
}

// 用注册表里的命令行(可能含 %1 占位)启动应用打开指定文件。
// UWP 应用的 command 是 `shell:AppsFolder\<AUMID>`,直接交给 explorer.exe。
async function openWithCommand(command: string, absPath: string): Promise<void> {
  if (command.startsWith('shell:AppsFolder\\')) {
    await spawnDetached('explorer.exe', [command]);
    return;
  }
  const tokens = parseCommandLine(command);
  if (tokens.length === 0) throw new Error('应用命令为空');
  const exe = tokens[0];
  const rest = tokens.slice(1).map(t => (t.includes('%1') ? t.replace(/%1/g, absPath) : t));
  // 命令行里没有 %1 占位(极少数关联)时,把文件路径追加到参数末尾
  if (!rest.some(t => t === absPath) && !tokens.slice(1).some(t => t.includes('%1'))) {
    rest.push(absPath);
  }
  await spawnDetached(exe, rest);
}

type OpenWithAppEntry = {
  id: string;
  name: string;
  iconDataUrl?: string;
  isDefault: boolean;
};

// 扩展名 -> { apps(前端可见), commands(appId -> command) }
// appId->command 映射只存服务端内存,前端仅持 opaque id,任意命令行不可能经前端注入(N2)
const openWithCache = new Map<string, { apps: OpenWithAppEntry[]; commands: Map<string, string> }>();

// 调用 PowerShell 脚本枚举某扩展名的打开方式
// 脚本路径多候选:mastra dev 的进程 cwd 是 src/mastra/public(实测 stat 的 absolutePath 证实),
// 直接相对路径会解析到不存在文件导致枚举恒 degraded(2026-09-18 复核实测)
const probeScriptCandidates = [
  'src/mastra/server/openwith-probe.ps1',
  '../../../src/mastra/server/openwith-probe.ps1',
];
const probeScriptPath = probeScriptCandidates.map(p => path.resolve(p)).find(p => fs.existsSync(p)) ?? 'src/mastra/server/openwith-probe.ps1';

function probeOpenWithApps(ext: string): Promise<{ apps: OpenWithAppEntry[]; commands: Map<string, string> }> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probeScriptPath, '-Ext', ext],
      { cwd: process.cwd(), windowsHide: true }
    );

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      ps.kill();
      reject(new Error('probe timeout'));
    }, 25000);

    ps.stdout.on('data', data => {
      stdout += data.toString('utf8');
    });
    ps.stderr.on('data', data => {
      stderr += data.toString('utf8');
    });

    ps.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`probe exited with ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as Array<{
          name: string;
          command: string;
          isDefault: boolean;
          iconBase64?: string;
        }>;
        const commands = new Map<string, string>();
        const apps: OpenWithAppEntry[] = [];
        for (const item of parsed) {
          const id = randomUUID();
          commands.set(id, item.command);
          const app: OpenWithAppEntry = {
            id,
            name: item.name,
            isDefault: !!item.isDefault,
          };
          if (item.iconBase64) app.iconDataUrl = `data:image/png;base64,${item.iconBase64}`;
          apps.push(app);
        }
        resolve({ apps, commands });
      } catch (err) {
        reject(err);
      }
    });

    ps.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// 统一的路径解析:兼容 '/a.docx' 与 'a.docx' 两种写法。
// 旧写法 path.resolve(ROOT, `.${input}`) 在不带前导斜杠时会把 'a.docx' 拼成 '.a.docx'
// (隐藏文件名),导致 agent 产物标记里的相对路径一律 ENOENT。
// 返回 null 表示路径非法(上级穿越),调用方据此返回 400。
function resolveWorkspacePath(input: string): string | null {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(WORKSPACE_ROOT, normalized);
  const rel = path.relative(WORKSPACE_ROOT, abs);
  // rel 为空串表示就是工作区根目录本身(目录列表用),合法;'..' 开头或绝对路径则是穿越
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

// 找到实际存在的文件:直接命中优先,否则按 Unicode NFC 归一化比对同目录下的文件名。
// (中文文件在不同系统/传输环节可能是 NFD 形式,直接 readFile 会找不到)
async function resolveExistingFile(abs: string): Promise<string | null> {
  try {
    await stat(abs);
    return abs;
  } catch {
    // 继续走归一化匹配
  }
  try {
    const dir = path.dirname(abs);
    const target = path.basename(abs).normalize('NFC');
    const names = await readdir(dir);
    const match = names.find(name => name.normalize('NFC') === target);
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

export const workspaceRoutes = [
  registerApiRoute('/workspace/files', {
    method: 'GET',
    handler: async c => {
      try {
        const dir = c.req.query('path') || '/';
        const abs = resolveWorkspacePath(dir);
        if (!abs) return c.json({ error: '非法路径' }, 400);
        const dirents = await readdir(abs, { withFileTypes: true });
        // M9:隐藏建表工作目录(.xxx.ref/)不出现在产物列表
        const visibleEntries = dirents.filter(e => !e.name.startsWith('.'));
        const entries = await Promise.all(
          visibleEntries.map(async e => {
            const type = e.isDirectory() ? 'dir' : 'file';
            let mtimeMs: number | undefined;
            if (type === 'file') {
              try {
                const s = await stat(path.join(abs, e.name));
                mtimeMs = s.mtimeMs;
              } catch {
                // 单个文件 stat 失败时省略 mtimeMs,不影响整请求
              }
            }
            return {
              path: `${dir === '/' ? '' : dir}/${e.name}`,
              name: e.name,
              type,
              ...(mtimeMs !== undefined ? { mtimeMs } : {}),
            };
          }),
        );
        return c.json({ entries });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `读取失败: ${reason}` }, 500);
      }
    },
  }),

  // 新建或覆盖工作区文件;父目录不存在时递归创建。
  registerApiRoute('/workspace/files', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await c.req.json<{ path?: unknown; content?: unknown }>();
        const filePath = typeof body.path === 'string' ? body.path : '';
        const content = typeof body.content === 'string' ? body.content : '';
        if (!filePath) return c.json({ error: '缺少 path 参数' }, 400);

        const abs = resolveWorkspacePath(filePath);
        // abs === WORKSPACE_ROOT 说明 path 只是 '/',指向目录本身,不能当文件写
        if (!abs || abs === WORKSPACE_ROOT) return c.json({ error: '非法路径' }, 400);

        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
        return c.json({ ok: true, path: filePath });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `创建失败: ${reason}` }, 500);
      }
    },
  }),

  registerApiRoute('/workspace/files/content', {
    method: 'GET',
    handler: async c => {
      try {
        const filePath = c.req.query('path');
        if (!filePath) return c.json({ error: '缺少 path 参数' }, 400);
        const abs = resolveWorkspacePath(filePath);
        if (!abs) return c.json({ error: '非法路径' }, 400);
        const real = await resolveExistingFile(abs);
        if (!real) return c.json({ error: `文件不存在: ${filePath}` }, 404);
        const buf = await readFile(real);
        const text = buf.toString('utf-8');
        return c.json({ path: filePath, content: text });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `读取失败: ${reason}` }, 500);
      }
    },
  }),

  registerApiRoute('/workspace/files/raw', {
    method: 'GET',
    handler: async c => {
      try {
        const filePath = c.req.query('path');
        if (!filePath) return c.json({ error: '缺少 path 参数' }, 400);
        const abs = resolveWorkspacePath(filePath);
        // 防穿越校验与 content 路由保持一致
        if (!abs) return c.json({ error: '非法路径' }, 400);
        const real = await resolveExistingFile(abs);
        if (!real) return c.json({ error: `文件不存在: ${filePath}` }, 404);
        const buf = await readFile(real);
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const mimeTypes: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
          svg: 'image/svg+xml',
          ico: 'image/x-icon',
          pdf: 'application/pdf',
          epro: 'application/octet-stream',
          eprj: 'application/octet-stream',
        };
        const contentType = mimeTypes[ext] ?? 'application/octet-stream';
        return new Response(new Uint8Array(buf), {
          headers: { 'Content-Type': contentType },
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `读取失败: ${reason}` }, 500);
      }
    },
  }),

  // 将 docx/xlsx/xls 转成 HTML,供前端在禁脚本 iframe 中安全预览。
  registerApiRoute('/workspace/files/convert', {
    method: 'GET',
    handler: async c => {
      try {
        const filePath = c.req.query('path');
        if (!filePath) return c.json({ error: '缺少 path 参数' }, 400);
        const abs = resolveWorkspacePath(filePath);
        if (!abs || abs === WORKSPACE_ROOT) return c.json({ error: '非法路径' }, 400);

        const ext = path.extname(filePath).slice(1).toLowerCase();
        if (ext !== 'docx' && ext !== 'xlsx' && ext !== 'xls') {
          return c.json({ error: '该类型不支持转换' }, 400);
        }

        const real = await resolveExistingFile(abs);
        if (!real) return c.json({ error: `文件不存在: ${filePath}` }, 404);
        const buf = await readFile(real);
        if (ext === 'docx') {
          const result = await mammoth.convertToHtml({ buffer: buf });
          return c.json({ html: result.value, kind: 'docx' });
        }

        const workbook = XLSX.read(buf);
        const html = workbook.SheetNames.map(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          return `<h3>${sheetName}</h3>${XLSX.utils.sheet_to_html(sheet)}`;
        }).join('');
        return c.json({ html, kind: 'xlsx' });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `转换失败: ${reason}` }, 500);
      }
    },
  }),

  // GET /workspace/files/stat?path=  获取文件元信息
  registerApiRoute('/workspace/files/stat', {
    method: 'GET',
    handler: async c => {
      try {
        const filePath = c.req.query('path');
        if (!filePath) return c.json({ error: '缺少 path 参数' }, 400);
        const abs = resolveWorkspacePath(filePath);
        if (!abs) return c.json({ error: '非法路径' }, 400);
        const s = await stat(abs);
        return c.json({ size: s.size, absolutePath: abs });
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
          return c.json({ error: '文件不存在' }, 404);
        }
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `读取失败: ${reason}` }, 500);
      }
    },
  }),

  // POST /workspace/files/open  用系统默认方式打开文件
  registerApiRoute('/workspace/files/open', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await c.req.json<{ path?: unknown }>();
        const filePath = typeof body.path === 'string' ? body.path : '';
        if (!filePath) return c.json({ error: '缺少 path 参数' }, 400);

        const abs = resolveWorkspacePath(filePath);
        if (!abs || abs === WORKSPACE_ROOT) return c.json({ error: '非法路径' }, 400);

        // explorer.exe 直接认文件关联并启动默认程序,等价于 shell 的 start 动作,
        // 且不经过 cmd.exe 拼字符串,不存在引号转义问题
        await spawnDetached('explorer.exe', [abs]);
        return c.json({ ok: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `打开失败: ${reason}` }, 500);
      }
    },
  }),

  // POST /workspace/files/reveal  在资源管理器中定位文件
  registerApiRoute('/workspace/files/reveal', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await c.req.json<{ path?: unknown }>();
        const filePath = typeof body.path === 'string' ? body.path : '';
        if (!filePath) return c.json({ error: '缺少 path 参数' }, 400);

        const abs = resolveWorkspacePath(filePath);
        if (!abs || abs === WORKSPACE_ROOT) return c.json({ error: '非法路径' }, 400);

        // explorer /select 返回码常为 1,不代表失败,因此忽略错误
        await new Promise<void>(resolve => {
          exec(`explorer /select,"${abs}"`, { windowsHide: true }, () => resolve());
        });
        return c.json({ ok: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `定位失败: ${reason}` }, 500);
      }
    },
  }),

  // GET /workspace/files/openwith?path=&refresh=1  枚举可用来打开该文件的应用
  registerApiRoute('/workspace/files/openwith', {
    method: 'GET',
    handler: async c => {
      try {
        const filePath = c.req.query('path');
        if (!filePath) return c.json({ error: '缺少 path 参数' }, 400);
        const abs = resolveWorkspacePath(filePath);
        if (!abs || abs === WORKSPACE_ROOT) return c.json({ error: '非法路径' }, 400);

        const ext = path.extname(filePath).slice(1).toLowerCase();
        if (!ext) return c.json({ apps: [] });

        const refresh = c.req.query('refresh') === '1';
        if (!refresh) {
          const cached = openWithCache.get(ext);
          if (cached) return c.json({ apps: cached.apps });
        }

        try {
          const result = await probeOpenWithApps(ext);
          openWithCache.set(ext, result);
          return c.json({ apps: result.apps });
        } catch (probeErr) {
          // 诊断输出:枚举失败的直接原因(超时/退出码/JSON 解析)打到 server 日志
          console.error('[openwith] probe failed:', probeErr instanceof Error ? probeErr.message : probeErr);
          return c.json({ apps: [], degraded: true });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `枚举失败: ${reason}` }, 500);
      }
    },
  }),

  // POST /workspace/files/open-with  用指定应用打开文件
  registerApiRoute('/workspace/files/open-with', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await c.req.json<{ path?: unknown; appId?: unknown }>();
        const filePath = typeof body.path === 'string' ? body.path : '';
        const appId = typeof body.appId === 'string' ? body.appId : '';
        if (!filePath) return c.json({ error: '缺少 path 参数' }, 400);
        if (!appId) return c.json({ error: '缺少 appId 参数' }, 400);

        const abs = resolveWorkspacePath(filePath);
        if (!abs || abs === WORKSPACE_ROOT) return c.json({ error: '非法路径' }, 400);

        const ext = path.extname(filePath).slice(1).toLowerCase();
        const cached = openWithCache.get(ext);
        if (!cached) {
          console.error(`[open-with] cache miss: ext=${ext} cachedExts=${[...openWithCache.keys()].join(',')}`);
          return c.json({ error: '应用不可用，请重新打开菜单' }, 400);
        }

        const command = cached.commands.get(appId);
        if (!command) {
          console.error(`[open-with] appId miss: ext=${ext} appId=${appId} known=${[...cached.commands.keys()].join(',')}`);
          return c.json({ error: '应用不可用，请重新打开菜单' }, 400);
        }

        // 拒绝含双引号的路径,防止命令行注入
        if (abs.includes('"')) return c.json({ error: '非法文件名' }, 400);

        // 不再拼 cmd.exe /c 字符串:改用 openWithCommand 直接解析命令行并 spawn
        // 可执行文件(不经过 shell,无引号转义问题;失败会真正 reject 而不是被吞掉)
        await openWithCommand(command, abs);
        return c.json({ ok: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `打开失败: ${reason}` }, 500);
      }
    },
  }),

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

  // POST /workspace/export/pptx  { html, title } → 转换后返回 .pptx 二进制供前端直接下载
  registerApiRoute('/workspace/export/pptx', {
    method: 'POST',
    handler: async c => {
      try {
        const body = await c.req.json<{ html?: unknown; title?: unknown }>();
        const html = typeof body.html === 'string' ? body.html : '';
        const title = typeof body.title === 'string' && body.title ? body.title : '演示文稿';
        if (!html) return c.json({ error: '缺少 html 参数' }, 400);
        const tempRelPath = `.mew-exports/${randomUUID()}.pptx`;
        const result = await convertHtmlToPptx(html, tempRelPath);
        if (!result.success || !result.outputPath) {
          return c.json({ error: result.error ?? '转换失败' }, 500);
        }
        const buf = await readFile(result.outputPath);
        await rm(path.dirname(result.outputPath), { recursive: true, force: true }).catch(() => undefined);
        return new Response(new Uint8Array(buf), {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(title)}.pptx"`,
          },
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `导出失败: ${reason}` }, 500);
      }
    },
  }),

];
