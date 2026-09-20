// Phase 0 第 4 项:验证 Mastra 接线 —— 不进产品代码,验完即删
// 目标:证明能在不改 @mastra/core 的前提下,把 workspace 的 execute_command 送进 codex 沙箱
//
// 用法:node scripts/spike-mastra-sandbox.mjs
//
// 接法一(为何不替换 processes):
//   MastraSandbox 构造器把 executeCommand 做成捕获了 super() 那个 pm 的闭包(:3676-3705),
//   事后替换 this.processes 会留下静默漏洞 —— executeCommand 仍走旧的无沙箱 pm。
//   改为劫持 LocalProcessManager 的唯一包裹点 sandbox.wrapCommandForIsolation(:3091),
//   pm 不动 → 闭包与 this.processes 指向同一个 pm,两条路径都被覆盖。
//   同时把 isolation 改成非 'none',让 execa 走 shell:false(:3104),策略 JSON 才不被 cmd.exe 拼串打烂。
//
// 接法二(为何用批处理文件承载命令):
//   wrapCommandForIsolation 收到的是一整条命令串(可能含 && / 重定向),不是 argv 数组。
//   而 cmd.exe /c 不遵循 CRT argv 引号规则 —— Node 引一层、codex 再引一层后,
//   cmd.exe 把 \" 当字面量,报"文件名、目录名或卷标语法不正确"(命令压根没执行)。
//   实测(scripts/spike-quoting.mjs)可靠形式只有两种:argv 完全拆分,或把命令写进 .bat。
//   命令串无法可靠拆成 argv(等于要写个 shell 解析器),故选 .bat:
//   shell 语法全留在文件内,进程边界上只传一个无空格的 bat 路径。
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SBX_EXE = path.join(ROOT, 'vendor', 'codex', 'bin', 'codex.exe');
const SBX_HOME = path.join(ROOT, '.sandbox-home');
const WORKSPACE = path.join(ROOT, 'src', 'mastra', 'public', 'workspace');
// 命令承载目录:点前缀,workspace-routes.ts 的产物扫描会过滤掉;位于写根内,两档均可读写
const EXEC_DIR = path.join(WORKSPACE, '.mew-exec');

const CHILD_ENV = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
  COMSPEC: process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
};

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

// isolation 哨兵值:只需 !== 'none'(让 execa 用 shell:false)且 !== 'seatbelt'
// (避开 _prepareWorkspace 的 macOS 分支)。wrapCommandForIsolation 被整体覆盖,
// 该值不会被拿去查真实后端。
const ISOLATION_TAG = 'codex-windows';

class CodexSandbox extends LocalSandbox {
  constructor(options = {}) {
    super(options); // 传 'none' 让父类构造通过(Windows 上传别的会抛 IsolationUnavailableError)
    this._absWorkingDir = path.resolve(this.workingDirectory);
    this._writeRoots = [this._absWorkingDir, ...(options.extraWriteRoots ?? [])];
    this.isolation = ISOLATION_TAG; // isolation 是普通类字段(:4407),super() 后改写不影响构造校验
  }

  /**
   * 把命令串落成 .bat。文件名无空格无中文,进程边界上只传这一个路径。
   * ⚠️ Phase 1 未决:此处是同步的,拿不到进程结束时机,无法即时清理。
   *    实际实现应改为覆盖 processes.spawn(async)在 wait() 后删除,
   *    或在每次 spawn 前顺带清理超龄文件。
   */
  _writeCommandScript(command) {
    fs.mkdirSync(EXEC_DIR, { recursive: true });
    const file = path.join(EXEC_DIR, `cmd-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}.bat`);
    // chcp 65001 让中文路径与输出走 UTF-8;CRLF 是 bat 的行尾要求
    fs.writeFileSync(file, `@echo off\r\nchcp 65001>nul\r\n${command}\r\n`, 'utf8');
    return file;
  }

  /** LocalProcessManager 每次 spawn 都会调这里(:3091),是唯一的命令包裹点 */
  wrapCommandForIsolation(command) {
    const scriptPath = this._writeCommandScript(command);
    return {
      command: SBX_EXE,
      args: [
        '--run-as-windows-sandbox',
        '--codex-home', SBX_HOME,
        '--command-cwd', this._absWorkingDir,
        '--permission-profile', JSON.stringify(policy(this._writeRoots)),
        '--env-json', JSON.stringify(CHILD_ENV),
        '--windows-sandbox-level', 'restricted-token',
        '--workspace-root', this._absWorkingDir,
        '--',
        'cmd.exe', '/c', scriptPath,
      ],
    };
  }
}

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? '✅' : '❌'} ${name}`);
  if (detail) console.log(`   ${String(detail).replace(/\n/g, '\n   ')}`);
}
const tail = (s, n = 2) => (s ? String(s).trim().split('\n').slice(-n).join('\n') : '');

console.log('=== Mastra 接线验证(restricted-token 档)===\n');

if (!fs.existsSync(SBX_EXE)) {
  console.error('❌ 未找到沙箱二进制,先跑 node scripts/setup-sandbox-runtime.mjs');
  process.exit(1);
}
fs.mkdirSync(SBX_HOME, { recursive: true });
fs.mkdirSync(WORKSPACE, { recursive: true });

const sandbox = new CodexSandbox({ workingDirectory: WORKSPACE });
const workspace = new Workspace({
  id: 'spike-workspace',
  name: 'Spike Workspace',
  filesystem: new LocalFilesystem({ basePath: WORKSPACE }),
  sandbox,
});

// ---- 1. 包裹点确实指向 codex,且 executeCommand 可用 ----
{
  const hasExec = typeof sandbox.executeCommand === 'function';
  const wrapped = sandbox.wrapCommandForIsolation('echo probe');
  const viaCodex = wrapped.command === SBX_EXE && wrapped.args.includes('--run-as-windows-sandbox');
  check(
    '1. executeCommand 可用,且包裹点指向 codex 沙箱',
    hasExec && viaCodex,
    `executeCommand=${hasExec} | wrapped=${path.basename(wrapped.command)} | isolation=${sandbox.isolation}`,
  );
}

// ---- 2. 经 Mastra 全链路执行一条命令 ----
{
  const r = await sandbox.executeCommand('echo mastra-sandbox-alive', [], { timeout: 60_000 });
  check(
    '2. 经 Mastra executeCommand 在沙箱内执行成功',
    r.exitCode === 0 && String(r.stdout).includes('mastra-sandbox-alive'),
    r.exitCode === 0 ? `stdout: ${String(r.stdout).trim()}` : `exitCode=${r.exitCode} stderr: ${tail(r.stderr)}`,
  );
}

// ---- 3. shell 操作符 + 含空格路径穿过转义层 ----
// 首版正是在这里翻车(\" 被 cmd.exe 当字面量),故目标路径故意带空格。
const shellFile = path.join(WORKSPACE, '.spike mastra shell.txt');
{
  fs.rmSync(shellFile, { force: true });
  const r = await sandbox.executeCommand(
    `echo line1> "${shellFile}" && echo line2>> "${shellFile}"`,
    [],
    { timeout: 60_000 },
  );
  let content = '';
  try { content = fs.readFileSync(shellFile, 'utf8'); } catch {}
  const ok = content.includes('line1') && content.includes('line2');
  check(
    '3. shell 操作符(重定向 + &&)与含空格路径穿过转义层',
    ok,
    ok ? '文件两行齐全' : `exitCode=${r.exitCode} stderr: ${tail(r.stderr)} content=${JSON.stringify(content)}`,
  );
  fs.rmSync(shellFile, { force: true });
}

// ---- 4+5. 同一命令形式的正反对照(防假阳性的关键) ----
// 纪律:"越界被拒"必须与"界内成功"配对。若两者都失败,说明命令根本没跑,
// 拒绝断言无效 —— 前两轮的假阳性就是这么来的。
{
  const okDir = path.join(WORKSPACE, '.spike mastra ok');
  const badDir = path.join(ROOT, '.spike-MASTRA-ESCAPED');
  fs.rmSync(okDir, { recursive: true, force: true });
  fs.rmSync(badDir, { recursive: true, force: true });

  const rIn = await sandbox.executeCommand(`mkdir "${okDir}"`, [], { timeout: 60_000 });
  const insideOk = fs.existsSync(okDir);
  check(
    '4. 界内建目录(含空格):应成功 —— 反向测试的有效性前提',
    rIn.exitCode === 0 && insideOk,
    insideOk ? '已创建' : `exitCode=${rIn.exitCode} stderr: ${tail(rIn.stderr)}`,
  );

  const rOut = await sandbox.executeCommand(`mkdir "${badDir}"`, [], { timeout: 60_000 });
  const escaped = fs.existsSync(badDir);
  // 只有在"界内成功"的前提下,"界外失败"才能归因于沙箱
  const validDenial = insideOk && !escaped && rOut.exitCode !== 0;
  check(
    '5. 越界建目录:应被拒(且已排除语法错误导致的假阳性)',
    validDenial,
    escaped
      ? `⚠️ 沙箱未生效!已越界创建(已清理)`
      : insideOk
        ? `被拒 exitCode=${rOut.exitCode} | stderr: ${tail(rOut.stderr, 1) || '(空)'}`
        : `⚠️ 无法归因:界内也失败了,命令可能根本没执行`,
  );

  fs.rmSync(okDir, { recursive: true, force: true });
  fs.rmSync(badDir, { recursive: true, force: true });
}

// ---- 6. Python 越界写:确认拒绝带 PermissionError(内核级拒绝的铁证) ----
{
  const PY_EXE = path.join(ROOT, 'vendor', 'python', 'python.exe');
  if (!fs.existsSync(PY_EXE)) {
    check('6. Python 越界写被内核拒绝', false, `缺 ${PY_EXE},跳过`);
  } else {
    const escape = path.join(ROOT, '.spike-MASTRA-PY-ESCAPED.txt');
    fs.rmSync(escape, { force: true });
    // 经 Mastra 链路调 Python;stderr 里应出现 PermissionError,与"语法错误"可区分
    const r = await sandbox.executeCommand(
      `"${PY_EXE}" -c "open(r'${escape}','w').write('x')"`,
      [],
      { timeout: 60_000 },
    );
    const escaped = fs.existsSync(escape);
    const realDenial = !escaped && /PermissionError|Errno 13|Permission denied/i.test(String(r.stderr));
    check(
      '6. 经 Mastra 的 Python 越界写:被内核拒绝(stderr 含 PermissionError)',
      realDenial,
      escaped
        ? '⚠️ 沙箱未生效!Python 写出了 workspace(已清理)'
        : `exitCode=${r.exitCode} | stderr: ${tail(r.stderr, 2) || '(空 —— 未见 PermissionError,存疑)'}`,
    );
    fs.rmSync(escape, { force: true });
  }
}

// ---- 7. workspace 文件工具未被沙箱影响 ----
{
  const probe = '.spike-fs-probe.txt';
  let ok = false;
  let detail = '';
  try {
    await workspace.filesystem.writeFile(probe, 'fs-ok');
    // 不传 encoding 时 readFile 返回 Buffer(:828-829),必须显式指定才拿到字符串
    const text = await workspace.filesystem.readFile(probe, { encoding: 'utf-8' });
    ok = String(text).includes('fs-ok');
    detail = `读回: ${String(text).trim()}`;
    await workspace.filesystem.deleteFile(probe); // 方法名是 deleteFile,不是 delete
  } catch (e) {
    detail = `异常: ${e.message}`;
  }
  check('7. workspace 文件工具仍正常(未受沙箱影响)', ok, detail);
}

// 清理承载目录
fs.rmSync(EXEC_DIR, { recursive: true, force: true });

// ---- 汇总 ----
const passed = results.filter((r) => r.passed).length;
console.log(`\n=== ${passed}/${results.length} 通过 ===`);
if (passed < results.length) {
  console.log('\n未通过项:');
  for (const r of results.filter((x) => !x.passed)) console.log(`  - ${r.name}`);
  process.exitCode = 1;
}
