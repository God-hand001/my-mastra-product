// 一键环境配置脚本(新机器克隆后:node scripts/setup.mjs 或 npm run setup)
// 编排:Node 版本检查 → 三处 npm install → .env 生成 → Python 运行时 → codex 沙箱运行时
//      → 沙箱 elevated 管理员初始化(自动弹 UAC,用户点一次"是") → 内置扩展 → 终检报告
// 全程幂等:已完成的步骤自动跳过,可反复执行。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const ok = [];
const fail = [];

function step(title, fn) {
  process.stdout.write(`\n==== ${title} ====\n`);
  try {
    const result = fn();
    if (result === false) fail.push(title);
    else ok.push(title);
  } catch (err) {
    console.error(err?.message ?? err);
    fail.push(title);
  }
}

function run(cmd, args, opts = {}) {
  // Windows 上 npm/python 等是 .cmd/.exe,必须 shell:true 才能解析
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: IS_WIN, ...opts });
  return r.status === 0;
}

// ---------------------------------------------------------------- Node 版本
step('检查 Node 版本(需 ≥ 22.13)', () => {
  const v = process.versions.node; // 如 "22.23.2"
  const [maj, min] = v.split('.').map(Number);
  if (maj > 22 || (maj === 22 && min >= 13)) {
    console.log(`Node ${v} ✓`);
    return true;
  }
  console.error(`当前 Node ${v} 过旧。请到 https://nodejs.org 安装 22.13+ 后重跑。`);
  return false;
});

// ---------------------------------------------------------------- npm install ×3
step('安装根目录依赖', () => {
  if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
    console.log('node_modules 已存在,跳过(如需重装请删除后重跑)');
    return true;
  }
  return run('npm', ['install'], { cwd: ROOT });
});

for (const sub of ['app', 'app-desktop']) {
  step(`安装 ${sub}/ 依赖`, () => {
    const dir = path.join(ROOT, sub);
    if (fs.existsSync(path.join(dir, 'node_modules'))) {
      console.log('node_modules 已存在,跳过');
      return true;
    }
    return run('npm', ['install'], { cwd: dir });
  });
}

// ---------------------------------------------------------------- .env
step('生成 .env(若不存在)', () => {
  const envPath = path.join(ROOT, '.env');
  const examplePath = path.join(ROOT, '.env.example');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    if (/sk-你的key|tvly-你的key/.test(content)) {
      console.warn('⚠ .env 里还是占位符:请填入真实的 DEEPSEEK_API_KEY / TAVILY_API_KEY 后再启动后端');
      return true; // 不算失败,但用户必须自己填
    }
    console.log('.env 已存在且已填写 ✓');
    return true;
  }
  fs.copyFileSync(examplePath, envPath);
  console.warn('⚠ 已从 .env.example 生成 .env:请打开并填入真实的 DEEPSEEK_API_KEY / TAVILY_API_KEY');
  return true;
});

// ---------------------------------------------------------------- Python 运行时
step('Python 运行时就位(vendor/python)', () => {
  if (fs.existsSync(path.join(ROOT, 'vendor', 'python', 'python.exe'))) {
    console.log('python.exe 已存在,跳过');
    return true;
  }
  return run('node', ['scripts/setup-python-runtime.mjs'], { cwd: ROOT });
});

// ---------------------------------------------------------------- codex 沙箱运行时
step('codex 沙箱运行时就位(vendor/codex)', () => {
  if (fs.existsSync(path.join(ROOT, 'vendor', 'codex', 'bin', 'codex.exe'))) {
    console.log('codex.exe 已存在,跳过');
    return true;
  }
  return run('node', ['scripts/setup-sandbox-runtime.mjs'], { cwd: ROOT });
});

// ---------------------------------------------------------------- 沙箱 elevated 管理员初始化
step('沙箱 elevated 管理员初始化(会弹出 UAC 提权窗口,请点"是")', () => {
  const codexExe = path.join(ROOT, 'vendor', 'codex', 'bin', 'codex.exe');
  const home = path.join(ROOT, '.sandbox-home');
  const marker = path.join(home, '.sandbox', 'setup_marker.json');
  if (!IS_WIN) {
    console.log('非 Windows 环境,跳过(沙箱仅支持 Windows)');
    return true;
  }
  if (!fs.existsSync(codexExe)) {
    console.error('codex.exe 未就位(上一步应已安装),无法初始化');
    return false;
  }
  if (fs.existsSync(marker)) {
    console.log('setup_marker.json 已存在,跳过');
    return true;
  }
  // 通过 UAC 提权单独跑 setup 命令;输出重定向到日志文件(提权进程的 stdout 看不见)
  const logFile = path.join(ROOT, 'setup-sandbox-elevated.log');
  const inner = `"${codexExe}" sandbox setup --elevated --current-user --codex-home "${home}" > "${logFile}" 2>&1`;
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$p = Start-Process -FilePath cmd.exe -ArgumentList '/c ${inner.replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`,
    ],
    { stdio: 'inherit', shell: false },
  );
  if (r.status !== 0 || !fs.existsSync(marker)) {
    console.error(
      'elevated 初始化未完成(可能拒绝了 UAC,或需要管理员)。' +
        '\n  可手动执行:管理员 PowerShell 中运行 ' +
        `"${codexExe}" sandbox setup --elevated --current-user --codex-home "${home}"` +
        '\n  日志: ' + logFile,
    );
    return false;
  }
  console.log('沙箱 elevated 初始化完成 ✓');
  return true;
});

// ---------------------------------------------------------------- 内置扩展
step('内置技能与连接器配置', () => {
  if (fs.existsSync(path.join(ROOT, 'extensions', 'skills')) &&
      fs.readdirSync(path.join(ROOT, 'extensions', 'skills')).length > 0) {
    console.log('extensions/ 已有内容,跳过(如需重建请删除后重跑)');
    return true;
  }
  // 从 GitHub 拉取开源技能,网络不通时不阻断整体(extensions 是可选增强)
  const done = run('node', ['scripts/setup-extensions.mjs'], { cwd: ROOT });
  if (!done) console.warn('⚠ 扩展配置失败,不影响启动;可稍后重跑 node scripts/setup-extensions.mjs');
  return true;
});

// ---------------------------------------------------------------- 终检报告
console.log('\n================ 配置结果 ================');
for (const t of ok) console.log(`  ✓ ${t}`);
for (const t of fail) console.log(`  ✗ ${t}`);

if (fail.length === 0) {
  console.log('\n环境就绪!接下来的启动步骤(需要两个终端):');
  console.log('  终端1:  npm run dev          # 后端,端口 4111');
  console.log('  终端2:  cd app-desktop && npm run desktop   # 桌面端');
  console.log('  (浏览器方式: cd app && npm run dev → http://localhost:5173)');
  console.log('\n别忘了确认 .env 里已填真实 API Key。');
} else {
  console.log('\n有步骤未完成,修复上方 ✗ 项后重跑本脚本即可(幂等,已完成的会跳过)。');
  process.exitCode = 1;
}
