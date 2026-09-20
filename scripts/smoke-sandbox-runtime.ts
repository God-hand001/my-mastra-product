// sandbox-runtime.ts 冒烟测试(M11-Phase1)
// tsc 只证明类型自洽,本脚本真正执行模块逻辑。
//
// 用法(编译成 CJS 再跑;Node 的 ESM 加载器不接受产品代码里的无扩展名相对导入):
//   npx tsc scripts/smoke-sandbox-runtime.ts --module commonjs --target ES2022 \
//     --moduleResolution node --esModuleInterop --skipLibCheck --types node --outDir .tmp-smoke
//   node .tmp-smoke/scripts/smoke-sandbox-runtime.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPolicy,
  buildShellWrapperArgv,
  buildWrapperArgv,
  decodeOutput,
  execScriptDir,
  isElevatedSetupComplete,
  isLikelySandboxDenial,
  prewarmSandbox,
  resetSandboxRuntimeCache,
  resolveSandboxRuntime,
  sandboxPreflight,
  sandboxedExecFile,
  sweepExecScripts,
  tierPolicyOptions,
} from '../src/mastra/services/sandbox-runtime';
import { resolveProjectRoot, workspaceRoot } from '../src/mastra/services/project-root';

const results: { name: string; passed: boolean }[] = [];
function check(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed });
  console.log(`${passed ? '✅' : '❌'} ${name}`);
  if (detail) console.log(`   ${detail.replace(/\n/g, '\n   ')}`);
}
function info(name: string, detail?: string) {
  console.log(`ℹ️  ${name}`);
  if (detail) console.log(`   ${detail.replace(/\n/g, '\n   ')}`);
}
const tail = (s: string, n = 2) => (s ? s.trim().split('\n').slice(-n).join('\n') : '');
const ms = (t: number) => `${(t / 1000).toFixed(1)}s`;

const ROOT = resolveProjectRoot();
const WS = workspaceRoot();
const PY = path.join(ROOT, 'vendor', 'python', 'python.exe');
const hasPython = fs.existsSync(PY);

console.log('=== sandbox-runtime 冒烟测试 ===\n');
console.log(`projectRoot: ${ROOT}`);
console.log(`workspace:   ${WS}\n`);

// 包成 main():本脚本编译为 CJS 运行(见文件头用法),CJS 不支持顶层 await。
// 为何编 CJS:产品代码按项目约定用无扩展名相对导入(tsconfig moduleResolution=bundler,
// 由 Mastra 打包器解析),Node 的 ESM 加载器不接受;CJS 的解析器接受。
async function main(): Promise<void> {

// ---- 1. 运行时定位与档位判定 ----
{
  let detail = '';
  let ok = false;
  try {
    const rt = resolveSandboxRuntime();
    ok = fs.existsSync(rt.exe) && rt.level === 'elevated';
    detail = `exe=${path.relative(ROOT, rt.exe)} | level=${rt.level} | setupComplete=${isElevatedSetupComplete(rt.codexHome)}`;
  } catch (e) {
    detail = `抛错: ${(e as Error).message.split('\n')[0]}`;
  }
  check('1. resolveSandboxRuntime 定位成功且档位为 elevated', ok, detail);
}

// ---- 2. 预检信息可读 ----
{
  const pf = sandboxPreflight();
  check('2. sandboxPreflight 返回就绪', pf.ok, pf.message);
}

// ---- 3. 默认拒读路径的构造耗时(存在性检查) ----
{
  const t0 = Date.now();
  const { denyReadPaths } = buildPolicy('workspace-write');
  const elapsed = Date.now() - t0;
  check('3. buildPolicy 构造快速(<500ms)且拒读列表非空', elapsed < 500 && denyReadPaths.length > 0,
    `${denyReadPaths.length} 条 / ${ms(elapsed)}\n` + denyReadPaths.map(p => `- ${path.basename(p)}`).join('\n'));
}

// ---- 4. restricted-token 档必须不带 deny 条目(否则沙箱拒绝启动) ----
// permissions.rs:873 的 has_full_disk_read_access 带 deny 即 false → 后端 bail
{
  const elevated = buildPolicy('workspace-write', {}, 'elevated');
  const restricted = buildPolicy('workspace-write', {}, 'restricted-token');
  const rtDenyEntries = restricted.profile.file_system.entries.filter(e => e.access === 'deny');
  const elDenyEntries = elevated.profile.file_system.entries.filter(e => e.access === 'deny');
  check('4. restricted-token 档不含 deny 条目 / elevated 档含有',
    rtDenyEntries.length === 0 && elDenyEntries.length > 0,
    `restricted-token: ${rtDenyEntries.length} 条 deny | elevated: ${elDenyEntries.length} 条 deny`);
}

// ---- 5. readonly 预设无可写根 ----
{
  const ro = buildPolicy('readonly');
  const ww = buildPolicy('workspace-write');
  const pw = buildPolicy('project-write', { extraWriteRoots: [path.join(ROOT, 'docs')] });
  check('5. 三档预设的可写根符合语义',
    ro.writeRoots.length === 0 && ww.writeRoots.length === 1 && pw.writeRoots.length === 2,
    `readonly: ${ro.writeRoots.length} | workspace-write: ${ww.writeRoots.length} | project-write: ${pw.writeRoots.length}`);
}

// ---- 6. argv 形状:deny-read 显式传参 ----
{
  const { argv } = buildWrapperArgv({ command: 'cmd.exe', args: ['/c', 'echo', 'x'], policy: 'workspace-write' });
  const hasDenyFlag = argv.includes('--deny-read-paths-json');
  const dashDashIdx = argv.indexOf('--');
  const cmdAfterDash = argv[dashDashIdx + 1] === 'cmd.exe';
  const levelOk = argv[argv.indexOf('--windows-sandbox-level') + 1] === 'elevated';
  check('6. wrapper argv 形状正确(含 --deny-read-paths-json,命令在 -- 之后)',
    hasDenyFlag && cmdAfterDash && levelOk,
    `deny-flag=${hasDenyFlag} | 命令位置正确=${cmdAfterDash} | level=elevated:${levelOk} | argv 长度=${argv.length}`);
}

// ---- 7. 环境变量最小化:不得泄漏 API key ----
{
  const { argv } = buildWrapperArgv({ command: 'cmd.exe', args: ['/c', 'echo'], policy: 'readonly' });
  const envJson = argv[argv.indexOf('--env-json') + 1] ?? '';
  const env = JSON.parse(envJson) as Record<string, string>;
  const keys = Object.keys(env);
  // 真实机密名(不打印值)
  const leaky = keys.filter(k => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k));
  check('7. 传入沙箱的环境变量最小化(无 KEY/TOKEN/SECRET 类)', leaky.length === 0,
    `${keys.length} 个变量: ${keys.join(', ')}${leaky.length ? ` | ⚠️ 疑似泄漏: ${leaky.join(', ')}` : ''}`);
}

// ---- 8. 实际执行:界内写成功 ----
const insideFile = path.join(WS, '.smoke-inside.txt');
if (!hasPython) {
  check('8. sandboxedExecFile 界内写成功', false, '缺 Python 运行时,跳过');
} else {
  fs.rmSync(insideFile, { force: true });
  const t0 = Date.now();
  const r = await sandboxedExecFile(PY, ['-c', `open(r"${insideFile}","w").write("smoke")`], {
    policy: 'workspace-write',
  });
  const elapsed = Date.now() - t0;
  const created = fs.existsSync(insideFile);
  check('8. sandboxedExecFile 界内写成功', r.exitCode === 0 && created,
    `exitCode=${r.exitCode} created=${created} | 耗时 ${ms(elapsed)}${r.stderr ? `\nstderr: ${tail(r.stderr)}` : ''}`);
  info('附. elevated 档单次调用开销', `${ms(elapsed)} —— 含 logon + ACL 应用;若过慢需考虑降低 deny 路径数量`);
}

// ---- 9. 实际执行:越界写被拒且 deniedBySandbox 为真 ----
if (!hasPython) {
  check('9. 越界写被拒且 deniedBySandbox 标记正确', false, '缺 Python 运行时,跳过');
} else {
  const escape = path.join(ROOT, '.smoke-ESCAPED.txt');
  fs.rmSync(escape, { force: true });
  const r = await sandboxedExecFile(PY, ['-c', `open(r"${escape}","w").write("x")`], {
    policy: 'workspace-write',
  });
  const escaped = fs.existsSync(escape);
  // 有效性前提:第 8 项界内写必须成功,否则无法归因
  const inside8 = results.find(x => x.name.startsWith('8.'))?.passed ?? false;
  check('9. 越界写被拒,且 deniedBySandbox 标记为真', inside8 && !escaped && r.deniedBySandbox,
    escaped ? '⚠️ 沙箱未生效!文件被创建(已清理)'
      : `exitCode=${r.exitCode} deniedBySandbox=${r.deniedBySandbox} | ${tail(r.stderr, 1)}`);
  fs.rmSync(escape, { force: true });
}
fs.rmSync(insideFile, { force: true });

// ---- 10. deny-read 真的生效(经产品模块,非 spike) ----
if (!hasPython) {
  check('10. deny-read 经产品模块生效', false, '缺 Python 运行时,跳过');
} else {
  const secret = path.join(ROOT, '.smoke-fake-secret.txt');
  const plain = path.join(ROOT, '.smoke-plain.txt');
  fs.writeFileSync(secret, 'FAKE=leak-me\n', 'utf8');
  fs.writeFileSync(plain, 'PLAIN=ok\n', 'utf8');

  const rPlain = await sandboxedExecFile(PY, ['-c', `print(open(r"${plain}").read().strip())`], {
    policy: 'workspace-write',
  });
  const canRead = rPlain.exitCode === 0 && rPlain.stdout.includes('PLAIN=ok');

  const rSecret = await sandboxedExecFile(PY, ['-c', `print(open(r"${secret}").read().strip())`], {
    policy: 'workspace-write',
    policyOptions: { extraDenyRead: [secret] },
  });
  const leaked = rSecret.stdout.includes('leak-me');

  check('10. deny-read 经产品模块生效(含正反配对)', canRead && !leaked && rSecret.deniedBySandbox,
    leaked ? `⚠️ deny-read 未生效!内容被读出`
      : canRead ? `对照可读=${canRead} | 拒读 exitCode=${rSecret.exitCode} denied=${rSecret.deniedBySandbox}`
      : `⚠️ 无法归因:对照项也读不到 (${tail(rPlain.stderr, 1)})`);

  fs.rmSync(secret, { force: true });
  fs.rmSync(plain, { force: true });
}

// ---- 11. 断网(默认策略) ----
if (!hasPython) {
  check('11. 默认断网 / allowNetwork 放行', false, '缺 Python 运行时,跳过');
} else {
  const netCode = "import socket; socket.create_connection(('223.5.5.5',53),timeout=6); print('net-open')";
  const rBlocked = await sandboxedExecFile(PY, ['-c', netCode], { policy: 'workspace-write' });
  const blocked = !rBlocked.stdout.includes('net-open');
  const rOpen = await sandboxedExecFile(PY, ['-c', netCode], {
    policy: 'workspace-write',
    policyOptions: { allowNetwork: true },
  });
  const opened = rOpen.stdout.includes('net-open');
  check('11. 默认断网 / allowNetwork:true 放行(正反配对)', blocked && opened,
    `默认: ${blocked ? '已拦截' : '⚠️ 未拦截'} | allowNetwork: ${opened ? '连通' : '未连通'}` +
      (!opened ? '\n⚠️ 放行也连不上 → 可能本机无外网,断网结论无法归因' : ''));
}

// ---- 12. shell 路径:命令串经 .bat 承载,含操作符与空格路径 ----
{
  const target = path.join(WS, '.smoke shell out.txt');
  fs.rmSync(target, { force: true });
  const { exe, argv } = buildShellWrapperArgv(
    `echo line1> "${target}" && echo line2>> "${target}"`,
    { policy: 'workspace-write' },
  );
  // 直接执行这套 argv(模拟 Mastra 的 execute_command 路径)
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  let code = 0;
  try {
    await run(exe, argv, { timeout: 120_000, windowsHide: true, encoding: 'buffer' });
  } catch (e) {
    code = (e as { code?: number }).code ?? 1;
  }
  let content = '';
  try { content = fs.readFileSync(target, 'utf8'); } catch {}
  const ok = content.includes('line1') && content.includes('line2');
  check('12. shell 命令串(重定向+&&+含空格路径)经 .bat 正确执行', ok,
    ok ? '两行齐全' : `code=${code} content=${JSON.stringify(content)}`);
  fs.rmSync(target, { force: true });
}

// ---- 13. .bat 扫龄清理 ----
{
  const dir = execScriptDir();
  const before = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.bat')).length : 0;
  // 造一个"老"文件
  fs.mkdirSync(dir, { recursive: true });
  const stale = path.join(dir, 'cmd-stale-test.bat');
  fs.writeFileSync(stale, '@echo off\r\n', 'utf8');
  const oldTime = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(stale, oldTime, oldTime);
  sweepExecScripts();
  const staleGone = !fs.existsSync(stale);
  const after = fs.readdirSync(dir).filter(f => f.endsWith('.bat')).length;
  check('13. sweepExecScripts 清理超龄 .bat', staleGone,
    `超龄文件已删=${staleGone} | 清理前 ${before} 个 → 现 ${after} 个`);
}

// ---- 14. 工具函数:解码与拒绝判定 ----
{
  const utf8 = decodeOutput(Buffer.from('中文 UTF-8', 'utf8')) === '中文 UTF-8';
  // GBK 编码的"拒绝访问"
  const gbkBuf = Buffer.from([0xbe, 0xdc, 0xbe, 0xf8, 0xb7, 0xc3, 0xce, 0xca]);
  const gbk = decodeOutput(gbkBuf).includes('拒绝');
  const denialTrue = isLikelySandboxDenial(1, 'PermissionError: [Errno 13] Permission denied');
  const denialFalse = isLikelySandboxDenial(127, 'command not found');
  const zeroFalse = !isLikelySandboxDenial(0, 'Permission denied');
  check('14. decodeOutput(UTF-8/GBK) 与 isLikelySandboxDenial 行为正确',
    utf8 && gbk && denialTrue && !denialFalse && zeroFalse,
    `utf8=${utf8} gbk=${gbk} 命中=${denialTrue} 非拒绝码=${!denialFalse} 退出0=${zeroFalse}`);
}

// ---- 15. fail-closed:未 setup 的 home 必须抛错,不静默降级 ----
{
  const fakeHome = path.join(os.tmpdir(), `mew-fake-home-${Date.now()}`);
  fs.mkdirSync(fakeHome, { recursive: true });
  const saved = process.env.MEW_SANDBOX_HOME;
  process.env.MEW_SANDBOX_HOME = fakeHome;
  resetSandboxRuntimeCache();
  let threw = false;
  let msg = '';
  try {
    resolveSandboxRuntime();
  } catch (e) {
    threw = (e as { kind?: string }).kind === 'sandbox_setup_incomplete';
    msg = (e as Error).message.split('\n')[0];
  }
  // 还原
  if (saved === undefined) delete process.env.MEW_SANDBOX_HOME;
  else process.env.MEW_SANDBOX_HOME = saved;
  resetSandboxRuntimeCache();
  fs.rmSync(fakeHome, { recursive: true, force: true });
  check('15. fail-closed:未 setup 的 codex-home 抛 SandboxSetupIncompleteError', threw,
    threw ? msg : '⚠️ 未抛错 —— 可能静默降级为无防护运行');
}

// ---- 16. tierPolicyOptions 形状:full 档不得用 special:root 作可写根 ----
// 实测(diag-tier-policy.mjs):special:root 可写会让沙箱拒绝启动,报
// "resolve permission profile token mode" —— 上游判据是 !has_full_disk_write_access()。
{
  const def = tierPolicyOptions('default');
  const full = tierPolicyOptions('full');
  const defEmpty = Object.keys(def).length === 0;
  const fullHasRoots = (full.extraWriteRoots?.length ?? 0) > 0;
  const fullNetwork = full.allowNetwork === true;
  const { profile } = buildPolicy('workspace-write', full, 'elevated');
  const writeEntries = profile.file_system.entries.filter(e => e.access === 'write');
  const noSpecialRootWrite = writeEntries.length > 0 && writeEntries.every(e => e.path.type === 'path');
  check('16. tierPolicyOptions:default 为空 / full 含具体可写根与放行网络,且无 special:root 写条目',
    defEmpty && fullHasRoots && fullNetwork && noSpecialRootWrite,
    `default 键数=${Object.keys(def).length} | full 可写根=${full.extraWriteRoots?.join(', ')}` +
      ` | 放行网络=${full.allowNetwork} | 写条目均为具体路径=${noSpecialRootWrite}`);
}

// ---- 17. full 档实际可越界写(F7/F9 的基础能力) ----
// 正反配对:default 档必须拒、full 档必须放行;两者同形式同目标。
if (!hasPython) {
  check('17. default 档拒绝越界写 / full 档放行', false, '缺 Python 运行时,跳过');
} else {
  const outside = path.join(ROOT, '.smoke-tier-outside.txt');
  const writeCode = `open(r"${outside}","w").write("tier")`;

  fs.rmSync(outside, { force: true });
  await sandboxedExecFile(PY, ['-c', writeCode], { policy: 'workspace-write' });
  const deniedByDefault = !fs.existsSync(outside);
  fs.rmSync(outside, { force: true });

  const rFull = await sandboxedExecFile(PY, ['-c', writeCode], {
    policy: 'workspace-write',
    policyOptions: tierPolicyOptions('full'),
  });
  const allowedByFull = fs.existsSync(outside);
  fs.rmSync(outside, { force: true });

  check('17. default 档拒绝越界写 / full 档放行(正反配对)',
    deniedByDefault && allowedByFull,
    `default: ${deniedByDefault ? '被拒' : '⚠️ 未拦截'} | ` +
      `full: ${allowedByFull ? '成功' : `⚠️ 仍被拒 exitCode=${rFull.exitCode} ${tail(rFull.stderr, 1)}`}`);
}

// ---- 18. prewarmSandbox 可执行并报告耗时 ----
// 注:第 17 项改动过可写根集合,可能触发访问控制项重写,故此处耗时可能偏高。
{
  const r = await prewarmSandbox();
  check('18. prewarmSandbox 执行成功并报告耗时', r.ok && r.elapsedMs > 0, r.message);
}

// ---- 汇总 ----
const passed = results.filter(r => r.passed).length;
console.log(`\n=== ${passed}/${results.length} 通过 ===`);
if (passed < results.length) {
  console.log('\n未通过项:');
  for (const r of results.filter(x => !x.passed)) console.log(`  - ${r.name}`);
  process.exitCode = 1;
}

} // end main

main().catch(err => {
  console.error(`\n❌ 冒烟测试异常终止: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
