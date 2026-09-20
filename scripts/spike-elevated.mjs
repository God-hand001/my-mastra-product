// Phase 0 第 5 项:验证 elevated 档 —— 不进产品代码,验完即删
// 目标:确认 elevated 档能提供 restricted-token 拿不到的三件事:
//   ① deny-read(agent 读不到敏感文件)② WFP 断网 ③ 独立身份运行
// 并验证第 4 件关乎产品的事:④ 沙箱身份产出的文件,后端能否读回(预览面板链路)
//
// 用法:node scripts/spike-elevated.mjs [codexHome]
//   默认用 C:\Users\dongshaoqi\.codex —— 该 home 已完成 elevated setup
//   (本机 CodexSandboxOffline/Online 账户建于 2026-09-01,cap_sid 的
//    writable_root_by_path 有十几条记录)。
//
// ⚠️ 为何不用项目的 .sandbox-home:
//   凭据与"可写根→能力 SID"映射都按 codex-home 存。项目那个 home 是跑
//   restricted-token 时自动生成的,writable_root_by_path 为空 → elevated 档
//   报 "workspace-write sandbox has no writable root capability SIDs"
//   (spawn_prep.rs:425)。要用独立 home 必须对它单独跑一次 setup(需管理员)。
//
// ⚠️ 副作用:会往所用 codex-home 的 cap_sid 追加本 workspace 的能力 SID,
//   并在该目录上打 ACL。与平时正常使用 codex 时发生的事同类。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SBX_EXE = path.join(ROOT, 'vendor', 'codex', 'bin', 'codex.exe');
const WORKSPACE = path.join(ROOT, 'src', 'mastra', 'public', 'workspace');
const PY_EXE = path.join(ROOT, 'vendor', 'python', 'python.exe');
const CODEX_HOME = process.argv[2] ?? path.join(os.homedir(), '.codex');

const CHILD_ENV = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
  COMSPEC: process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
};

/**
 * @param opts.writeRoots 可写路径
 * @param opts.denyRead   拒绝读取的路径(elevated 档专属能力)
 * @param opts.network    'restricted' 断网 | 'enabled' 放行
 */
function policy({ writeRoots = [], denyRead = [], network = 'restricted' } = {}) {
  return {
    type: 'managed',
    file_system: {
      type: 'restricted',
      entries: [
        { path: { type: 'special', value: { kind: 'root' } }, access: 'read' },
        ...writeRoots.map((p) => ({ path: { type: 'path', path: p }, access: 'write' })),
        // deny 优先级高于 read/write(同特异性下 deny>write>read)
        ...denyRead.map((p) => ({ path: { type: 'path', path: p }, access: 'deny' })),
      ],
    },
    network,
  };
}

function decode(buf) {
  if (!buf?.length) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).trim();
  } catch {
    try { return new TextDecoder('gbk').decode(buf).trim(); } catch { return buf.toString('latin1').trim(); }
  }
}

function run(innerArgv, policyOpts = {}, level = 'elevated') {
  const args = [
    '--run-as-windows-sandbox',
    '--codex-home', CODEX_HOME,
    '--command-cwd', WORKSPACE,
    '--permission-profile', JSON.stringify(policy({ writeRoots: [WORKSPACE], ...policyOpts })),
    '--env-json', JSON.stringify(CHILD_ENV),
    '--windows-sandbox-level', level,
    '--workspace-root', WORKSPACE,
    '--',
    ...innerArgv,
  ];
  // deny-read 需显式传参:codex 自己的调用链是先用
  // resolve_windows_elevated_filesystem_overrides 从策略提取 deny 条目,
  // 再经独立的 --deny-read-paths-json 交给 wrapper(sandboxing/src/windows.rs)。
  // 实测只在 permission-profile 里写 access:'deny' 不生效。
  if (policyOpts.denyRead?.length) {
    args.splice(args.indexOf('--'), 0,
      '--deny-read-paths-json', JSON.stringify(policyOpts.denyRead));
  }
  // elevated 档要做 logon + ACL 应用,比 restricted-token 慢,给足超时
  const r = spawnSync(SBX_EXE, args, { timeout: 180_000, windowsHide: true, shell: false });
  return { code: r.status, stdout: decode(r.stdout), stderr: decode(r.stderr), spawnError: r.error?.message };
}

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? '✅' : '❌'} ${name}`);
  if (detail) console.log(`   ${String(detail).replace(/\n/g, '\n   ')}`);
}
function info(name, detail) {
  console.log(`ℹ️  ${name}`);
  if (detail) console.log(`   ${String(detail).replace(/\n/g, '\n   ')}`);
}
const tail = (s, n = 2) => (s ? String(s).trim().split('\n').slice(-n).join('\n') : '');

console.log('=== elevated 档验证 ===\n');
console.log(`codex-home: ${CODEX_HOME}`);
console.log(`workspace:  ${WORKSPACE}\n`);

if (!fs.existsSync(SBX_EXE)) {
  console.error('❌ 未找到沙箱二进制,先跑 node scripts/setup-sandbox-runtime.mjs');
  process.exit(1);
}
const hasPython = fs.existsSync(PY_EXE);

// ---- 0. 门禁:elevated 档能否启动 ----
// 不通过则后续全部无意义,直接退出并给出可诊断信息。
{
  const r = run(['cmd.exe', '/c', 'echo', 'elevated-alive']);
  const ok = r.code === 0 && r.stdout.includes('elevated-alive');
  check('0. elevated 档能启动进程', ok,
    ok ? `stdout: ${r.stdout}` : `code=${r.code}\nstderr: ${tail(r.stderr, 4)}\nspawnError: ${r.spawnError ?? '-'}`);
  if (!ok) {
    console.log('\n⛔ elevated 档无法启动,后续测试跳过。');
    console.log('   若报 "no writable root capability SIDs" → 该 codex-home 未做过 elevated setup');
    console.log(`   补做:vendor/codex/bin/codex.exe sandbox setup --elevated --current-user`);
    process.exit(1);
  }
}

// ---- 1. 身份切换:子进程是否以独立沙箱账户运行 ----
// 这是 elevated 与 restricted-token 的根本差别(后者仍是当前用户戴手铐)。
// ⚠️ 不能用 %USERNAME% 判断:环境变量由我们通过 --env-json 传入,传什么就是什么,
//    说明不了真实身份(首版这么写导致误报"身份未切换")。改用 Win32 GetUserNameW
//    直接查进程令牌。
if (!hasPython) {
  check('1. 子进程以独立沙箱账户身份运行', false, '缺 Python 运行时,跳过');
} else {
  const probe = [
    'import ctypes',
    'buf = ctypes.create_unicode_buffer(256)',
    'size = ctypes.c_ulong(256)',
    'ctypes.windll.advapi32.GetUserNameW(buf, ctypes.byref(size))',
    'print(buf.value)',
  ].join('; ');
  const r = run([PY_EXE, '-c', probe]);
  const who = r.stdout.trim();
  const switched = /CodexSandbox/i.test(who);
  check('1. 子进程以独立沙箱账户身份运行(查进程令牌,非环境变量)', switched,
    `令牌身份=${who || '(空)'} | 当前用户=${process.env.USERNAME}` +
      (r.code !== 0 ? `\ncode=${r.code} stderr: ${tail(r.stderr)}` : ''));
}

// ---- 2+3. deny-read 正反配对(elevated 专属能力) ----
// 纪律:"读不到"必须配一条"读得到",否则无法排除"文件本来就读不了"。
const secretFile = path.join(ROOT, '.spike-fake-secret.txt');
const publicFile = path.join(ROOT, '.spike-public.txt');
if (!hasPython) {
  check('2. 未被 deny 的文件:应能读到', false, '缺 Python 运行时,跳过');
  check('3. 被 deny-read 的文件:应读不到', false, '缺 Python 运行时,跳过');
} else {
  // 用假密钥文件,不碰真实 .env
  fs.writeFileSync(secretFile, 'FAKE_SECRET=do-not-leak\n', 'utf8');
  fs.writeFileSync(publicFile, 'PUBLIC_OK=yes\n', 'utf8');

  const readCode = (f) => `print(open(r"${f}").read().strip())`;

  // 2. 对照:不加 deny,应能读到(证明读路径本身通)
  const rPub = run([PY_EXE, '-c', readCode(publicFile)]);
  const canRead = rPub.code === 0 && rPub.stdout.includes('PUBLIC_OK');
  check('2. 未被 deny 的文件:应能读到 —— deny 测试的有效性前提', canRead,
    canRead ? `读到: ${rPub.stdout}` : `code=${rPub.code} stderr: ${tail(rPub.stderr)}`);

  // 3. 加 deny-read,应读不到
  const rSec = run([PY_EXE, '-c', readCode(secretFile)], { denyRead: [secretFile] });
  const leaked = rSec.code === 0 && rSec.stdout.includes('do-not-leak');
  const realDenial = canRead && !leaked && /PermissionError|Errno 13|Permission denied/i.test(rSec.stderr);
  check('3. 被 deny-read 的文件:应读不到(且排除假阳性)', realDenial,
    leaked
      ? `⚠️ deny-read 未生效!内容被读出: ${rSec.stdout}`
      : canRead
        ? `被拒 code=${rSec.code} | stderr: ${tail(rSec.stderr, 1) || '(未见 PermissionError,存疑)'}`
        : `⚠️ 无法归因:对照项也读不到`);

  fs.rmSync(secretFile, { force: true });
  fs.rmSync(publicFile, { force: true });
}

// ---- 4. WFP 断网 ----
// restricted-token 档实测"未被拦截",此处应变为被拦截。
if (!hasPython) {
  check('4. network=restricted 时断网', false, '缺 Python 运行时,跳过');
} else {
  const netCode = "import socket; socket.create_connection(('223.5.5.5',53),timeout=6); print('net-open')";
  const rBlocked = run([PY_EXE, '-c', netCode], { network: 'restricted' });
  const blocked = !(rBlocked.code === 0 && rBlocked.stdout.includes('net-open'));

  // 对照:network=enabled 应能连通。若两者都连不上 → 本机无外网,断网结论无效。
  const rOpen = run([PY_EXE, '-c', netCode], { network: 'enabled' });
  const openWorks = rOpen.code === 0 && rOpen.stdout.includes('net-open');

  check('4. network=restricted 断网 / network=enabled 放行(正反配对)',
    blocked && openWorks,
    `restricted: ${blocked ? '已拦截' : '⚠️ 未拦截'} | enabled: ${openWorks ? '连通' : '未连通'}` +
      (!openWorks ? '\n⚠️ enabled 也连不上 → 可能本机无外网,断网结论无法归因' : '') +
      (blocked ? `\nrestricted stderr: ${tail(rBlocked.stderr, 1)}` : ''));
}

// ---- 5. 越界写仍被拦(确认 elevated 档没弄丢写保护) ----
{
  const okDir = path.join(WORKSPACE, '.spike elev ok');
  const badDir = path.join(ROOT, '.spike-ELEV-ESCAPED');
  fs.rmSync(okDir, { recursive: true, force: true });
  fs.rmSync(badDir, { recursive: true, force: true });

  const rIn = run(['cmd.exe', '/c', 'mkdir', okDir]);
  const insideOk = fs.existsSync(okDir);
  const rOut = run(['cmd.exe', '/c', 'mkdir', badDir]);
  const escaped = fs.existsSync(badDir);

  check('5. 界内写成功 / 越界写被拒(正反配对)', insideOk && !escaped,
    `界内: ${insideOk ? '成功' : `失败 code=${rIn.code} ${tail(rIn.stderr, 1)}`}` +
      ` | 界外: ${escaped ? '⚠️ 越界成功!' : `被拒 code=${rOut.code}`}`);

  fs.rmSync(badDir, { recursive: true, force: true });

  // ---- 6. 跨身份回读:沙箱账户产出的文件,当前用户能否读回 ----
  // 预览面板与产物标记链路依赖这条 —— elevated 档的真正产品风险点。
  if (insideOk) {
    const artifact = path.join(WORKSPACE, '.spike-elev-artifact.txt');
    fs.rmSync(artifact, { force: true });
    // 由沙箱账户创建文件
    const rWrite = hasPython
      ? run([PY_EXE, '-c', `open(r"${artifact}","w").write("made-by-sandbox")`])
      : run(['cmd.exe', '/c', 'echo', 'made-by-sandbox', '>', artifact]);

    let content = '';
    let readErr;
    try {
      content = fs.readFileSync(artifact, 'utf8').trim();
    } catch (e) {
      readErr = e.message;
    }
    const readable = content.includes('made-by-sandbox');
    check('6. 沙箱账户产出的文件,后端(当前用户)可读回', readable,
      readErr
        ? `⚠️ 读取失败: ${readErr} —— 预览面板链路会断,需处理文件归属`
        : readable
          ? `读回: ${content}`
          : `文件${fs.existsSync(artifact) ? '存在但内容不符' : '未生成'} | write code=${rWrite.code} ${tail(rWrite.stderr, 1)}`);

    // 顺带看归属:能否删除(产物清理链路)
    let deletable = false;
    try {
      fs.rmSync(artifact, { force: true });
      deletable = !fs.existsSync(artifact);
    } catch (e) {
      readErr = e.message;
    }
    info(`附. 后端能否删除沙箱产出的文件:${deletable ? '能' : '不能'}`,
      deletable ? '' : '产物清理链路需要额外处理');
  } else {
    check('6. 沙箱账户产出的文件,后端可读回', false, '前置界内写失败,无法验证');
  }

  fs.rmSync(okDir, { recursive: true, force: true });
}

// ---- 汇总 ----
const passed = results.filter((r) => r.passed).length;
console.log(`\n=== ${passed}/${results.length} 通过 ===`);
if (passed < results.length) {
  console.log('\n未通过项:');
  for (const r of results.filter((x) => !x.passed)) console.log(`  - ${r.name}`);
  process.exitCode = 1;
}
