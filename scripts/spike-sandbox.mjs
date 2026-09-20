// Phase 0 可行性验证(spike):不进产品代码,验完即删
// 目标:证明 codex 沙箱能在内核层拦住越界写入,而不是靠字符串匹配
//
// 用法:node scripts/spike-sandbox.mjs
//
// 本轮只用 restricted-token 档(免管理员)。该档只能强制"写"限制;
// deny-read 与断网需要 elevated 档(一次性管理员 setup),另行验证。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SBX_EXE = path.join(ROOT, 'vendor', 'codex', 'bin', 'codex.exe');
const SBX_HOME = path.join(ROOT, '.sandbox-home');
const WORKSPACE = path.join(ROOT, 'src', 'mastra', 'public', 'workspace');
const PY_EXE = path.join(ROOT, 'vendor', 'python', 'python.exe');

// 沙箱内子进程的环境。cmd.exe 需要 SystemRoot/COMSPEC 才能启动。
const CHILD_ENV = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
  COMSPEC: process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
};

/**
 * 策略:整盘可读 + 指定目录可写 + 断网。
 * entries 的冲突优先级由 codex 按"路径特异性 + deny>write>read"裁决,
 * 所以 root:read 与 workspace:write 可以共存。
 * path 的三种形状见 codex-rs/protocol/src/permissions.rs 的 RawFileSystemPath:
 *   {type:'path',path}(具体路径) / {type:'glob_pattern',pattern} / {type:'special',value:{kind}}
 */
function policy(writeRoots) {
  return {
    type: 'managed',
    file_system: {
      type: 'restricted',
      entries: [
        { path: { type: 'special', value: { kind: 'root' } }, access: 'read' },
        ...writeRoots.map((p) => ({ path: { type: 'path', path: p }, access: 'write' })),
      ],
    },
    network: 'restricted',
  };
}

// 中文 Windows 上 cmd.exe 的错误输出是 GBK,Python 是 UTF-8。
// 先按 UTF-8 严格解码,失败才回退 GBK(合法 UTF-8 极少会被误判)。
function decodeOutput(buf) {
  if (!buf || buf.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).trim();
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf).trim();
    } catch {
      return buf.toString('latin1').trim();
    }
  }
}

function runSandboxed({ command, cwd, writeRoots, level = 'restricted-token' }) {
  const args = [
    '--run-as-windows-sandbox',
    '--codex-home', SBX_HOME,
    '--command-cwd', cwd,
    '--permission-profile', JSON.stringify(policy(writeRoots)),
    '--env-json', JSON.stringify(CHILD_ENV),
    '--windows-sandbox-level', level,
    '--workspace-root', cwd,
    '--',
    ...command,
  ];
  // encoding 不设 → 拿 Buffer 自行解码(见 decodeOutput);shell:false 让策略 JSON 直传,不过 cmd.exe 拼串
  const r = spawnSync(SBX_EXE, args, { timeout: 120_000, windowsHide: true, shell: false });
  return {
    code: r.status,
    stdout: decodeOutput(r.stdout),
    stderr: decodeOutput(r.stderr),
    spawnError: r.error?.message,
  };
}

/** 用 Python 写文件:比 cmd.exe 重定向可靠(无引号/重定向符经三层转义的问题),且报错是干净 UTF-8 */
function pyWrite(target) {
  return [PY_EXE, '-c', `open(r"${target}","w").write("spike")`];
}

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? '✅' : '❌'} ${name}`);
  if (detail) console.log(`   ${detail.replace(/\n/g, '\n   ')}`);
}
function info(name, detail) {
  console.log(`ℹ️  ${name}`);
  if (detail) console.log(`   ${detail.replace(/\n/g, '\n   ')}`);
}
/** 取 stderr 末尾几行,避免 traceback 淹没输出 */
function tailErr(stderr, n = 3) {
  return stderr ? `\nstderr: ${stderr.split('\n').slice(-n).join('\n')}` : '';
}

console.log('=== codex 沙箱可行性验证(restricted-token 档)===\n');
console.log(`沙箱二进制: ${SBX_EXE}`);
console.log(`codex-home: ${SBX_HOME}`);
console.log(`可写根:     ${WORKSPACE}\n`);

fs.mkdirSync(SBX_HOME, { recursive: true });
fs.mkdirSync(WORKSPACE, { recursive: true });

if (!fs.existsSync(SBX_EXE)) {
  console.error(`❌ 未找到沙箱二进制,先跑 node scripts/setup-sandbox-runtime.mjs`);
  process.exit(1);
}
const hasPython = fs.existsSync(PY_EXE);
if (!hasPython) {
  console.error(`⚠️  未找到 ${PY_EXE},先跑 node scripts/setup-python-runtime.mjs;Python 相关项将跳过\n`);
}

// ---- 1. 策略 JSON 被接受 + 沙箱能启动进程 ----
{
  const r = runSandboxed({
    command: ['cmd', '/c', 'echo', 'sandbox-alive'],
    cwd: WORKSPACE,
    writeRoots: [WORKSPACE],
  });
  check(
    '1. 策略 JSON 被接受,沙箱内能启动进程',
    r.code === 0 && r.stdout.includes('sandbox-alive'),
    r.code === 0 ? `stdout: ${r.stdout}` : `code=${r.code}${tailErr(r.stderr)}\nspawnError: ${r.spawnError ?? '-'}`,
  );
}

// ---- 2. Python 运行时 + 文档依赖在沙箱内可用 ----
// 关系到 M7/M8/M9 三条已验收流水线是否会被沙箱打断。
const insideFile = path.join(WORKSPACE, '.spike-inside.txt');
if (hasPython) {
  const r = runSandboxed({
    command: [PY_EXE, '-c', 'import docx, pptx, openpyxl; print("py-deps-ok")'],
    cwd: WORKSPACE,
    writeRoots: [WORKSPACE],
  });
  check(
    '2. Python 运行时 + 文档依赖在沙箱内可用',
    r.code === 0 && r.stdout.includes('py-deps-ok'),
    r.code === 0 ? `stdout: ${r.stdout}` : `code=${r.code}${tailErr(r.stderr)}`,
  );

  // ---- 3. 写入可写根内:应成功 ----
  fs.rmSync(insideFile, { force: true });
  const w = runSandboxed({ command: pyWrite(insideFile), cwd: WORKSPACE, writeRoots: [WORKSPACE] });
  const created = fs.existsSync(insideFile);
  check(
    '3. Python 写入 workspace 内:应成功',
    w.code === 0 && created,
    created ? `已创建: ${path.basename(insideFile)}` : `code=${w.code}${tailErr(w.stderr)}`,
  );

  // ---- 4. 写入可写根外:应被拒(沙箱的核心价值) ----
  // 用 open() 直写 —— xlsx-build.ts 那 5 条正则黑名单完全拦不住这种写法。
  const pyEscape = path.join(ROOT, '.spike-PY-ESCAPED.txt');
  fs.rmSync(pyEscape, { force: true });
  const e = runSandboxed({ command: pyWrite(pyEscape), cwd: WORKSPACE, writeRoots: [WORKSPACE] });
  const escaped = fs.existsSync(pyEscape);
  check(
    '4. Python 用 open() 写 workspace 外:应被拒',
    !escaped,
    escaped
      ? `⚠️ 沙箱未生效!文件真的被创建了: ${pyEscape}(已清理)`
      : `被拒(code=${e.code})${tailErr(e.stderr)}`,
  );
  fs.rmSync(pyEscape, { force: true });
} else {
  check('2. Python 运行时 + 文档依赖在沙箱内可用', false, '缺 Python 运行时,跳过');
  check('3. Python 写入 workspace 内:应成功', false, '缺 Python 运行时,跳过');
  check('4. Python 用 open() 写 workspace 外:应被拒', false, '缺 Python 运行时,跳过');
}

// ---- 5. shell 路径(对应 execute_command):越界建目录应被拒 ----
// 用 mkdir 而非重定向,避开引号经三层转义的问题。
{
  const okDir = path.join(WORKSPACE, '.spike-dir');
  const badDir = path.join(ROOT, '.spike-ESCAPED-dir');
  fs.rmSync(okDir, { recursive: true, force: true });
  fs.rmSync(badDir, { recursive: true, force: true });

  const inside = runSandboxed({ command: ['cmd', '/c', 'mkdir', okDir], cwd: WORKSPACE, writeRoots: [WORKSPACE] });
  const outside = runSandboxed({ command: ['cmd', '/c', 'mkdir', badDir], cwd: WORKSPACE, writeRoots: [WORKSPACE] });
  const insideOk = fs.existsSync(okDir);
  const escaped = fs.existsSync(badDir);
  check(
    '5. shell(cmd.exe):workspace 内建目录成功 / 外被拒',
    insideOk && !escaped,
    `内: ${insideOk ? '成功' : `失败 code=${inside.code}${tailErr(inside.stderr, 1)}`}` +
      ` | 外: ${escaped ? '⚠️ 越界成功!沙箱未生效' : `被拒 code=${outside.code}`}`,
  );
  fs.rmSync(okDir, { recursive: true, force: true });
  fs.rmSync(badDir, { recursive: true, force: true });
}

// ---- 6. 跨身份回读:沙箱内产出的文件,当前用户能否读回 ----
// 预览面板与产物标记链路依赖这条。restricted-token 档仍是当前用户身份,
// 真正的考验在 elevated 档(独立沙箱账户),此处先建立基线。
if (fs.existsSync(insideFile)) {
  let content = '';
  let readErr;
  try {
    content = fs.readFileSync(insideFile, 'utf8').trim();
  } catch (err) {
    readErr = err.message;
  }
  check(
    '6. 沙箱内产出的文件,后端可读回',
    content.includes('spike'),
    readErr ? `读取失败: ${readErr}` : `内容: ${content}`,
  );
} else {
  check('6. 沙箱内产出的文件,后端可读回', false, '前置步骤 3 未产出文件,无法验证');
}
fs.rmSync(insideFile, { force: true });

// ---- 附:网络 ----
// restricted-token 档按设计拦不住网络(WFP 断网需 elevated,见 sandboxing/src/windows.rs:110-118)。
// 这里只记录事实,作为 elevated 档的对比基线,不计入通过率。
if (hasPython) {
  const r = runSandboxed({
    command: [PY_EXE, '-c', "import socket; socket.create_connection(('223.5.5.5',53),timeout=5); print('net-open')"],
    cwd: WORKSPACE,
    writeRoots: [WORKSPACE],
  });
  const open = r.code === 0 && r.stdout.includes('net-open');
  info(
    `附. 网络连通性(restricted-token 档):${open ? '未被拦截(符合预期)' : '未连通'}`,
    open
      ? 'WFP 断网需 elevated 档;本档只强制写限制'
      : `code=${r.code} —— 可能是沙箱拦截,也可能是本机无外网,需在 elevated 档对比确认${tailErr(r.stderr, 2)}`,
  );
}

// ---- 汇总 ----
const passed = results.filter((r) => r.passed).length;
console.log(`\n=== ${passed}/${results.length} 通过 ===`);
if (passed < results.length) {
  console.log('\n未通过项:');
  for (const r of results.filter((x) => !x.passed)) console.log(`  - ${r.name}`);
  process.exitCode = 1;
}
