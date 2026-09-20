// 沙箱运行时一键就位脚本(codex Windows 沙箱)
// 流程:定位来源(本机 npm 全局 → vendor/_dist 缓存 → npm 下载)→ 按原结构拷贝 → 冒烟 → 写版本标记
// 可重复执行:同名同大小的文件自动跳过。运行:node scripts/setup-sandbox-runtime.mjs
//
// 为什么必须保留目录结构(不能拍平成一个 exe):
//   codex.exe 在 elevated 档要拉起 codex-command-runner.exe,查找方式是相对自身位置
//   推算 ../codex-resources/(见 codex-rs/windows-sandbox-rs/src/helper_materialization.rs
//   的 RESOURCES_DIRNAME 与 legacy_lookup)。只拷 codex.exe 会导致 elevated 档找不到 runner。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'vendor', '_dist');
const SBX_DIR = path.join(ROOT, 'vendor', 'codex');
const SBX_EXE = path.join(SBX_DIR, 'bin', 'codex.exe');

// 锁定版本:沙箱的 --permission-profile 是 codex 内部 schema,无稳定性承诺(见 m11 计划风险 1)。
// 升级版本必须重跑 spike 验证策略 JSON 仍被接受。
const CODEX_VERSION = '0.152.0';
const NPM_PKG = `@openai/codex@${CODEX_VERSION}-win32-x64`;
// npm 包内的相对根:三个 exe 都在这个目录下
const PKG_VENDOR_SUBPATH = path.join('vendor', 'x86_64-pc-windows-msvc');

// 需要拷贝的文件:相对来源根的路径 → 相对 vendor/codex 的路径(保持一致,即原结构)
const ARTIFACTS = [
  { rel: path.join('bin', 'codex.exe'), note: '沙箱启动器(含 --run-as-windows-sandbox 入口)' },
  { rel: path.join('codex-resources', 'codex-command-runner.exe'), note: 'elevated 档以沙箱身份执行子进程' },
  { rel: path.join('codex-resources', 'codex-windows-sandbox-setup.exe'), note: '一次性管理员 setup 助手' },
];

const step = (msg) => console.log(`\n==> ${msg}`);

/** 本机可能存在的 npm 全局安装位置(嵌套 node_modules 是 npm 装可选平台包的常见形态) */
function candidateSourceRoots() {
  const home = os.homedir();
  const roots = [];
  const npmGlobals = [
    path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules'),
    path.join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
  ].filter(Boolean);
  for (const g of npmGlobals) {
    // 嵌套形态:@openai/codex/node_modules/@openai/codex-win32-x64/...
    roots.push(path.join(g, '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', PKG_VENDOR_SUBPATH));
    // 平铺形态:@openai/codex-win32-x64/...
    roots.push(path.join(g, '@openai', 'codex-win32-x64', PKG_VENDOR_SUBPATH));
  }
  // 上一次 npm 下载解出来的缓存
  roots.push(path.join(DIST, 'codex-win32-x64', 'package', PKG_VENDOR_SUBPATH));
  return roots;
}

/** 来源根必须同时含三个产物才算有效 */
function isValidSourceRoot(root) {
  return ARTIFACTS.every((a) => fs.existsSync(path.join(root, a.rel)));
}

function findSourceRoot() {
  for (const root of candidateSourceRoots()) {
    if (isValidSourceRoot(root)) return root;
  }
  return null;
}

/** 兜底:用 npm pack 把平台包拉到 vendor/_dist 并解开(镜像由用户 npm 配置决定) */
function downloadViaNpm() {
  fs.mkdirSync(DIST, { recursive: true });
  const outDir = path.join(DIST, 'codex-win32-x64');
  fs.mkdirSync(outDir, { recursive: true });

  const existingTgz = fs.existsSync(outDir)
    ? fs.readdirSync(outDir).find((f) => f.endsWith('.tgz'))
    : undefined;
  let tgz = existingTgz ? path.join(outDir, existingTgz) : undefined;

  if (!tgz) {
    console.log(`npm pack ${NPM_PKG} …(体积较大,请耐心等待)`);
    const r = spawnSync('npm', ['pack', NPM_PKG, '--pack-destination', outDir], {
      stdio: 'inherit',
      shell: true,
    });
    if (r.status !== 0) throw new Error(`npm pack 失败(${r.status})`);
    const found = fs.readdirSync(outDir).find((f) => f.endsWith('.tgz'));
    if (!found) throw new Error('npm pack 未产出 .tgz');
    tgz = path.join(outDir, found);
  } else {
    console.log(`已存在,跳过下载: ${tgz}`);
  }

  console.log(`解包: ${tgz}`);
  const r = spawnSync('tar', ['-xf', tgz, '-C', outDir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`解包失败(${r.status})`);

  const root = path.join(outDir, 'package', PKG_VENDOR_SUBPATH);
  if (!isValidSourceRoot(root)) {
    throw new Error(`解包后未在 ${root} 找到全部三个产物`);
  }
  return root;
}

/** 同名同大小视为已就位(exe 无版本号可查,用大小做廉价校验) */
function copyIfNeeded(srcRoot, artifact) {
  const src = path.join(srcRoot, artifact.rel);
  const dst = path.join(SBX_DIR, artifact.rel);
  const srcStat = fs.statSync(src);
  if (fs.existsSync(dst) && fs.statSync(dst).size === srcStat.size) {
    console.log(`已存在,跳过: ${artifact.rel}`);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const mb = (srcStat.size / 1024 / 1024).toFixed(1);
  console.log(`拷贝 ${artifact.rel}(${mb} MB)— ${artifact.note}`);
  fs.copyFileSync(src, dst);
}

function main() {
  if (process.platform !== 'win32') {
    throw new Error('codex 沙箱仅支持 Windows(macOS 走 seatbelt、Linux 走 bwrap,均为另一套后端)');
  }

  step('定位来源');
  let srcRoot = findSourceRoot();
  if (srcRoot) {
    console.log(`命中本机安装: ${srcRoot}`);
  } else {
    console.log('本机未找到已安装的 codex 平台包,改用 npm 下载');
    console.log(`尝试过:\n  ${candidateSourceRoots().join('\n  ')}`);
    srcRoot = downloadViaNpm();
  }

  step('按原结构拷贝到 vendor/codex');
  fs.mkdirSync(SBX_DIR, { recursive: true });
  for (const artifact of ARTIFACTS) copyIfNeeded(srcRoot, artifact);

  step('冒烟验证');
  const r = spawnSync(SBX_EXE, ['--version'], { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) {
    throw new Error(
      `沙箱二进制无法执行: ${SBX_EXE}\n原因: ${r.error?.message ?? r.stderr ?? `退出码 ${r.status}`}`,
    );
  }
  console.log(`codex --version → ${r.stdout.trim()}`);

  // 版本标记:排查"策略 JSON 被拒"类问题时先看这里对不对
  fs.writeFileSync(
    path.join(SBX_DIR, 'VERSION.json'),
    `${JSON.stringify({ codexVersion: CODEX_VERSION, source: srcRoot, installedAt: new Date().toISOString() }, null, 2)}\n`,
  );

  const total = ARTIFACTS.reduce((sum, a) => sum + fs.statSync(path.join(SBX_DIR, a.rel)).size, 0);
  console.log(`\n✅ 沙箱运行时就绪: vendor/codex/(${(total / 1024 / 1024).toFixed(0)} MB)`);
  console.log('   下一步:elevated 档需一次性管理员 setup(见 docs/spec 沙箱计划)');
}

try {
  main();
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  console.error('\n修复:确认已安装 codex CLI(npm i -g @openai/codex),或检查网络后重跑本脚本');
  process.exit(1);
}
