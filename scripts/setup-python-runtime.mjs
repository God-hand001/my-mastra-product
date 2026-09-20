// M7-T1:Python 运行时一键重建脚本
// 流程:下载 embeddable + get-pip → 解包 → 改 _pth → 引导 pip → 装依赖 → 拷贝转换器 → 冒烟
// 可重复执行:已有产物自动跳过对应步骤。运行:node scripts/setup-python-runtime.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'vendor', '_dist');
const PY_DIR = path.join(ROOT, 'vendor', 'python');
const PY_EXE = path.join(PY_DIR, 'python.exe');

const PY_VER = '3.12.10';
const PY_ZIP_NAME = `python-${PY_VER}-embed-amd64.zip`;
// 多镜像:python.org 官方在国内经常连不上,按序回退到国内镜像
const PY_ZIP_URLS = [
  `https://mirrors.huaweicloud.com/python/${PY_VER}/${PY_ZIP_NAME}`,
  `https://registry.npmmirror.com/-/binary/python/${PY_VER}/${PY_ZIP_NAME}`,
  `https://www.python.org/ftp/python/${PY_VER}/${PY_ZIP_NAME}`,
];
const GET_PIP_URLS = [
  'https://bootstrap.pypa.io/get-pip.py',
  'https://mirrors.aliyun.com/pypi/get-pip.py',
];
// 单文件下载超时;超时/失败自动换下一个源
const DOWNLOAD_TIMEOUT_MS = 120_000;

// pip 用国内源(官方源在国内基本不可用);失败再回退默认源
const PIP_MIRROR_ARGS = ['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple', '--timeout', '30'];

// 核心依赖(缺一不可)与可选依赖(个别缺失时降级,见 m7-task.md T1)
// M8 起追加 python-pptx;M9 起追加 openpyxl(建表)与 formulas(公式重算引擎)
const CORE_DEPS = ['python-docx', 'beautifulsoup4', 'lxml', 'Pillow', 'httpx', 'python-pptx', 'openpyxl', 'formulas'];
const OPT_DEPS = [
  'html-for-docx',
  // M10:官方 Python 版 MCP 服务器(连接器 fetch/time/git/sqlite 用 ${PY} 启动它们)。
  // 缺失时对应连接器启动失败并在扩展面板显示原因,不影响其余连接器。
  'mcp-server-fetch', 'mcp-server-time', 'mcp-server-git', 'mcp-server-sqlite',
];

// 仓库内自研 Python 包(拷贝进运行时 site-packages,运行时自包含)。
// 目录尚未创建时容忍跳过,包实现完成后重跑本脚本即生效。
const CONVERTER_PACKAGES = ['html_to_docx', 'html_to_pptx', 'xlsx_recalc'];

const step = (msg) => console.log(`\n==> ${msg}`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.status !== 0) {
    throw new Error(`命令失败(${r.status}): ${cmd} ${args.join(' ')}`);
  }
}

async function download(urls, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`已存在,跳过下载: ${dest}`);
    return;
  }
  const errors = [];
  for (const url of urls) {
    try {
      console.log(`下载: ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0);
      const chunks = [];
      let received = 0;
      for await (const chunk of res.body) {
        chunks.push(Buffer.from(chunk));
        received += chunk.byteLength;
        if (total) {
          process.stdout.write(`\r  ${received}/${total} 字节 (${Math.round((received / total) * 100)}%)`);
        } else {
          process.stdout.write(`\r  已接收 ${received} 字节`);
        }
      }
      process.stdout.write('\n');
      fs.writeFileSync(dest, Buffer.concat(chunks));
      return;
    } catch (e) {
      const reason = e?.name === 'TimeoutError' ? `超时(${DOWNLOAD_TIMEOUT_MS / 1000}s)` : (e?.message ?? e);
      errors.push(`${url} → ${reason}`);
      console.log(`  该源失败: ${reason},换下一个…`);
    }
  }
  throw new Error(`所有下载源均失败:\n  ${errors.join('\n  ')}`);
}

async function main() {
  fs.mkdirSync(DIST, { recursive: true });

  // 1. 下载(缓存于 vendor/_dist;多镜像 + 超时回退)
  step('下载发行版');
  await download(PY_ZIP_URLS, path.join(DIST, PY_ZIP_NAME));
  await download(GET_PIP_URLS, path.join(DIST, 'get-pip.py'));

  // 2. 解包到 vendor/python(已解过则跳过)
  step('解包 embeddable');
  if (fs.existsSync(PY_EXE)) {
    console.log(`已存在,跳过解包: ${PY_EXE}`);
  } else {
    fs.mkdirSync(PY_DIR, { recursive: true });
    // Windows 自带 tar(bsdtar) 支持 zip;失败再走 PowerShell Expand-Archive
    let ok = spawnSync('tar', ['-xf', path.join(DIST, PY_ZIP_NAME), '-C', PY_DIR], { stdio: 'inherit' }).status === 0;
    if (!ok) {
      run('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Path '${path.join(DIST, PY_ZIP_NAME)}' -DestinationPath '${PY_DIR}' -Force`]);
    }
    if (!fs.existsSync(PY_EXE)) throw new Error('解包后未找到 python.exe');
  }

  // 3. 改 python312._pth:放开 import site 并加入 site-packages(embeddable 默认禁用 site)
  step('配置 python312._pth');
  const pthPath = path.join(PY_DIR, `python${PY_VER.split('.').slice(0, 2).join('')}._pth`);
  if (!fs.existsSync(pthPath)) throw new Error(`未找到 ${pthPath}`);
  let pth = fs.readFileSync(pthPath, 'utf8');
  if (!pth.includes('Lib/site-packages')) {
    pth = pth.replace(/^#import site/m, 'import site');
    pth = pth.replace(/\r?\n$/, '') + '\nLib/site-packages\n';
    fs.writeFileSync(pthPath, pth);
    console.log(`已写入:\n${pth}`);
  } else {
    console.log('已配置,跳过');
  }

  // 4. 引导 pip
  step('引导 pip');
  const pipCheck = spawnSync(PY_EXE, ['-m', 'pip', '--version'], { encoding: 'utf8' });
  if (pipCheck.status === 0) {
    console.log(`pip 已就绪: ${pipCheck.stdout.trim()}`);
  } else {
    run(PY_EXE, [path.join(DIST, 'get-pip.py'), '--no-warn-script-location']);
  }

  // 5. 安装依赖(核心一套成功;可选逐个试,失败仅告警;先走国内镜像源)
  step('安装核心依赖(清华源)');
  let coreOk = spawnSync(PY_EXE, ['-m', 'pip', 'install', '--no-warn-script-location', ...PIP_MIRROR_ARGS, ...CORE_DEPS], { stdio: 'inherit' }).status === 0;
  if (!coreOk) {
    console.warn('[告警] 清华源安装失败,回退官方 PyPI…');
    run(PY_EXE, ['-m', 'pip', 'install', '--no-warn-script-location', ...CORE_DEPS]);
  }
  step('安装可选依赖');
  for (const dep of OPT_DEPS) {
    const r = spawnSync(PY_EXE, ['-m', 'pip', 'install', '--no-warn-script-location', ...PIP_MIRROR_ARGS, dep], { stdio: 'inherit' });
    if (r.status !== 0) console.warn(`[告警] 可选依赖 ${dep} 安装失败,转换器将不依赖它(T2 降级实现)`);
  }

  // 6. 拷贝自研 Python 包到运行时 site-packages(源码在仓库内,进 git;运行时自包含)
  step('拷贝自研 Python 包');
  for (const pkg of CONVERTER_PACKAGES) {
    const pkgSrc = path.join(ROOT, 'src', 'mastra', 'tools', pkg);
    const pkgDst = path.join(PY_DIR, 'Lib', 'site-packages', pkg);
    if (!fs.existsSync(path.join(pkgSrc, '__init__.py'))) {
      console.warn(`[告警] 包 ${pkg} 尚未创建,跳过拷贝(实现完成后重跑本脚本)`);
      continue;
    }
    fs.rmSync(pkgDst, { recursive: true, force: true });
    fs.cpSync(pkgSrc, pkgDst, { recursive: true });
    console.log(`已拷贝: ${pkgDst}`);
  }

  // 7. 冒烟
  step('冒烟验证');
  run(PY_EXE, ['--version']);
  run(PY_EXE, ['-c', "import docx, bs4, lxml, PIL, httpx; print('runtime-ok')"]);
  // M8/M9 新增依赖冒烟(pptx=演示文稿,openpyxl=建表,formulas=公式重算)
  run(PY_EXE, ['-c', "import pptx, openpyxl, formulas; print('m8m9-deps-ok')"]);

  console.log('\n✅ Python 运行时就绪: vendor/python/');
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
