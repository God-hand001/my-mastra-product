#!/usr/bin/env node
/**
 * T2: 内置扩展内容一键引入脚本
 * 1. 从 anthropics/skills 拉取开源技能（仅首次）
 * 2. 创建 3 个自研技能
 * 3. 生成 8 个官方 MCP 连接器配置
 * 4. 追加 extensions-local/ 到 .gitignore
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(__filename, '../..');

const EXT_DIR = path.join(ROOT, 'extensions');
const SKILLS_DIR = path.join(EXT_DIR, 'skills');
const CONNECTORS_DIR = path.join(EXT_DIR, 'connectors');
const LOCAL_EXT_DIR = path.join(ROOT, 'extensions-local');
const TMP_DIR = path.join(path.dirname(__filename), '.tmp-anthropics-skills');
const REPO_URL = 'https://github.com/anthropics/skills.git';
const REPO_WEB_URL = 'https://github.com/anthropics/skills';

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function writeFile(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf-8');
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

function getRepoCommit() {
  try {
    if (fs.existsSync(TMP_DIR)) {
      return execSync(`git -C "${TMP_DIR}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    }
  } catch {
    // 忽略错误，回退到 main
  }
  return 'main';
}

function fetchAnthropicsSkills() {
  if (fs.existsSync(TMP_DIR)) {
    console.log(`复用已存在的临时仓库：${TMP_DIR}`);
    return;
  }
  console.log('克隆 anthropics/skills...');
  execSync(`git clone --depth 1 "${REPO_URL}" "${TMP_DIR}"`, { stdio: 'inherit' });
}

function buildSourceMd(name, license) {
  const commit = getRepoCommit();
  return `# 来源声明

- 上游仓库：${REPO_WEB_URL}
- 相对路径：skills/${name}/
- commit/分支：${commit}
- License：${license}
- 引入日期：2026-09-15
`;
}

function installAnthropicsSkills() {
  const sourceSkillsDir = path.join(TMP_DIR, 'skills');
  if (!fs.existsSync(sourceSkillsDir)) {
    console.error('未找到上游 skills 目录');
    process.exit(1);
  }

  const entries = fs.readdirSync(sourceSkillsDir, { withFileTypes: true });
  let copied = 0;
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const src = path.join(sourceSkillsDir, ent.name);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) continue;

    const dest = path.join(SKILLS_DIR, ent.name);
    if (fs.existsSync(dest)) {
      console.log(`已存在，跳过：${ent.name}`);
      continue;
    }

    copyDir(src, dest);

    // 探测每个技能自带的 License 文件；没有则按仓库 README 声明记为 Apache-2.0
    const licenseFiles = ['LICENSE', 'LICENSE.txt', 'LICENSE.md'];
    let license = 'Apache-2.0（见上游 README 声明）';
    for (const lf of licenseFiles) {
      if (fs.existsSync(path.join(dest, lf))) {
        license = `见本目录 ${lf}`;
        break;
      }
    }

    writeFile(path.join(dest, 'SOURCE.md'), buildSourceMd(ent.name, license));
    copied++;
    console.log(`引入技能：${ent.name}`);
  }
  console.log(`本次新增 anthropics 技能 ${copied} 个`);
}

function createSelfSkills() {
  const skills = {
    'jlc-order-guide': `---
name: jlc-order-guide
description: 指导用户在嘉立创（JLC）完成 PCB、SMT、面板等下单流程，输出清晰步骤与检查清单。
---

# 嘉立创下單流程指導

## 適用場景
用戶需要在嘉立創（JLC）下單 PCB、SMT 貼片、面板、3D 打印等製造服務。

## 標準流程
1. **準備資料**：Gerber 文件、BOM 表、坐標文件（Centroid）、設計說明。
2. **上傳 Gerber**：登錄 JLC 下单頁面，選擇 PCB 打樣，上傳壓縮包。
3. **選擇工藝**：層數、板厚、阻焊顏色、表面處理、銅厚、最小線寬線距。
4. **BOM/坐標核對**：SMT 訂單需上傳 BOM 與坐標，核對器件位號、封裝、數量。
5. **下單付款**：確認交期、運費、優惠券，提交並支付。
6. **跟踪生產**：在「訂單中心」查看工程確認、生產、發貨進度。
7. **收貨驗貨**：對照 Gerber 與實物，檢查開短路、絲印、孔位。

## 注意事項
- 雙面板打樣默認 5PCS 起。
- SMT 坐標單位要與 PCB 設計單位一致（通常 mm）。
- 批量前務必先打樣驗證。
`,
    'eda-basics': `---
name: eda-basics
description: 讲解电子设计自动化（EDA）基本概念、设计流程与常见术语，辅助用户理解原理图、PCB、Gerber 等。
---

# EDA 基础常识

## 核心概念
- **原理图（Schematic）**：用符号表示元器件及连接关系。
- **网表（Netlist）**：从原理图提取的电气连接清单。
- **封装（Footprint）**：元器件在 PCB 上的物理焊盘与丝印图形。
- **PCB 布局（Layout）**：摆放器件、布线的过程。
- **DRC（设计规则检查）**：检查线宽、间距、孔径等是否满足工艺要求。

## 设计流程
1. 绘制原理图并 ERC 检查。
2. 生成网表，导入 PCB。
3. 布局、布线。
4. 运行 DRC。
5. 输出 Gerber、BOM、坐标。
6. 提交打样。

## 常用术语
- **Gerber**：PCB 制造标准光绘文件。
- **BOM**：物料清单。
- **Pick & Place / Centroid**：贴片机坐标文件。
- **阻抗控制**：高速信号线需控制走线宽度与层叠。
`,
    'word-html-spec': `---
name: word-html-spec
description: 规范 Word 文档生成：一律先写完整 HTML，再调用 html_to_docx 工具一次转换；包含 HTML 结构与样式约定。
---

# Word 文档生成规范

## 总原则
生成 \`.docx\` 一律先写一份完整 HTML（含 \`head\`/\`body\`），然后调用 \`html_to_docx\` 工具一次转换，禁止编写并执行任何一次性生成脚本（.js/.py）。

## HTML 约定速查
- 每个章节包一个顶层 \`<section>…</section>\`，每章自动从新页开始，不要自己插分页符。
- 目录位置放 \`<nav data-toc>目录</nav>\`（收录三级标题，Word 中可更新域刷新页码）。
- 页眉页脚用 \`<meta name="doc-header" content="…">\` / \`<meta name="doc-footer" content="第 {{page}} 页 / 共 {{pages}} 页">\`；封面章不需要页眉页脚时加 \`<meta name="doc-first-page-plain" content="true">\`。
- 纸张边距默认 A4 常规边距，可写 \`@page { size: A4; margin: 2.54cm 3.18cm }\`。
- 中文字体写在 \`body { font-family: "宋体", serif }\`（转 Word 时会正确写入中文字体）。
- 提示块用 \`<div class="callout" data-type="info|success|warning|danger">\`；数据卡片用 \`<div class="stat-cards">…</div>\`。
- 表格直接用 \`table/th/td\`，支持 border、th 背景、width 列宽；图片用 \`<img src="本地路径|data:|https://…" width="…">\`。
- 转换成功后按产物输出规范输出 \`【产物:…】\` 标记（只标记最终 \`.docx\`，不得把任何脚本标记为产物）。
- 转换失败时读取错误原因、修正 HTML 后重试，最多重试 2 次；仍失败就如实告知用户，不要假装成功。
- 生成或验证 Word 文档的全过程中，禁止编写/执行任何脚本（.js/.py）：转换是否成功以 \`html_to_docx\` 的返回结果为准，不要用脚本自检。

## 何时使用
用户请求 Word、.docx、报告、备忘录、信函等文档时，先读取本技能，再按上述规范生成 HTML 并调用工具。
`
  };

  for (const [name, body] of Object.entries(skills)) {
    const dest = path.join(SKILLS_DIR, name);
    if (fs.existsSync(dest)) {
      console.log(`自研技能已存在：${name}`);
      continue;
    }
    ensureDir(dest);
    writeFile(path.join(dest, 'SKILL.md'), body);
    writeFile(path.join(dest, 'SOURCE.md'), `# 来源声明

- 上游仓库：自有
- License：Apache-2.0
- 说明：本项目自研技能
- 创建日期：2026-09-15
`);
    console.log(`创建自研技能：${name}`);
  }
}

function createConnectors() {
  const connectors = [
    {
      name: 'everything',
      description: '官方 MCP 示例服务器，暴露一组基础工具用于测试与演示。',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
      env: {},
      capabilities: { network: true, externalWrite: ['\${NPMCACHE}'] },
    },
    {
      name: 'filesystem',
      description: '读写本地文件系统的 MCP 服务器，作用范围为工作区根目录。',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${ROOT}'],
      env: {},
      capabilities: { network: true, externalWrite: ['\${NPMCACHE}'] },
    },
    {
      // 官方 fetch 服务器是 Python 包(@modelcontextprotocol/server-fetch 在 npm 不存在),
      // 用 ${PY}(vendor/python/python.exe)运行;依赖由 setup-python-runtime.mjs 安装
      name: 'fetch',
      description: '通过 MCP 执行 HTTP 请求的 fetch 服务器(官方 Python 版,经内置 Python 运行时启动)。',
      transport: 'stdio',
      command: '${PY}',
      args: ['-m', 'mcp_server_fetch'],
      env: {},
      capabilities: { network: true },
    },
    {
      name: 'memory',
      description: '基于知识图谱的长期记忆 MCP 服务器。',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
      capabilities: { network: true, externalWrite: ['\${NPMCACHE}'] },
    },
    {
      name: 'sequential-thinking',
      description: '支持逐步推理与思维链的 MCP 服务器。',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      env: {},
      capabilities: { network: true, externalWrite: ['\${NPMCACHE}'] },
    },
    {
      // 官方 time 服务器是 Python 包,经 ${PY} 启动
      name: 'time',
      description: '获取当前时间、时区转换的 MCP 服务器(官方 Python 版,经内置 Python 运行时启动)。',
      transport: 'stdio',
      command: '${PY}',
      args: ['-m', 'mcp_server_time'],
      env: {}
    },
    {
      // 官方 git 服务器是 Python 包,经 ${PY} 启动
      name: 'git',
      description: '读取与分析 Git 仓库的 MCP 服务器(官方 Python 版,经内置 Python 运行时启动)。',
      transport: 'stdio',
      command: '${PY}',
      args: ['-m', 'mcp_server_git'],
      env: {}
    },
    {
      // 官方 sqlite 服务器是 Python 包,经 ${PY} 启动;示例库落在 workspace/data/
      name: 'sqlite',
      description: '操作 SQLite 数据库的 MCP 服务器，默认使用 workspace/data/sample.sqlite(官方 Python 版,经内置 Python 运行时启动)。',
      transport: 'stdio',
      command: '${PY}',
      args: ['-c', 'import sys; from mcp_server_sqlite import main; main()', '--db-path', '${ROOT}/data/sample.sqlite'],
      env: {}
    }
  ];

  for (const cfg of connectors) {
    const dest = path.join(CONNECTORS_DIR, cfg.name);
    if (fs.existsSync(dest)) {
      console.log(`连接器已存在：${cfg.name}`);
      continue;
    }
    ensureDir(dest);
    writeFile(path.join(dest, 'connector.json'), JSON.stringify(cfg, null, 2) + '\n');
    console.log(`创建连接器：${cfg.name}`);
  }
}

function updateGitignore() {
  const gitignore = path.join(ROOT, '.gitignore');
  let content = '';
  if (fs.existsSync(gitignore)) {
    content = fs.readFileSync(gitignore, 'utf-8');
  }
  if (content.includes('extensions-local/')) {
    console.log('.gitignore 已包含 extensions-local/');
    return;
  }
  const sep = content.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(gitignore, content + sep + 'extensions-local/\n', 'utf-8');
  console.log('已追加 extensions-local/ 到 .gitignore');
}

// 为 sqlite 连接器预建示例库(workspace/data/sample.sqlite),库不存在时该连接器会启动失败
function createSampleSqlite() {
  const dataDir = path.join(ROOT, 'src', 'mastra', 'public', 'workspace', 'data');
  const dbPath = path.join(dataDir, 'sample.sqlite');
  if (fs.existsSync(dbPath)) {
    console.log('示例库已存在，跳过：sample.sqlite');
    return;
  }
  ensureDir(dataDir);
  // python 已由 setup-python-runtime.mjs 就绪;这里用 sqlite3 模块建最小示例表
  const pythonExe = path.join(ROOT, 'vendor', 'python', 'python.exe');
  if (!fs.existsSync(pythonExe)) {
    console.warn('[告警] 未找到 Python 运行时,跳过示例库创建(先跑 setup-python-runtime.mjs)');
    return;
  }
  execFileSync(pythonExe, ['-c', `
import sqlite3
conn = sqlite3.connect(r'${dbPath.replace(/\\/g, '\\\\')}')
c = conn.cursor()
c.execute('CREATE TABLE IF NOT EXISTS 员工 (id INTEGER PRIMARY KEY, 姓名 TEXT, 部门 TEXT, 工资 REAL)')
c.execute('SELECT COUNT(*) FROM 员工')
if c.fetchone()[0] == 0:
    c.executemany('INSERT INTO 员工(姓名, 部门, 工资) VALUES (?,?,?)',
                  [('张三', '研发', 18000), ('李四', '市场', 12000), ('王五', '研发', 16000)])
conn.commit(); conn.close()
`], { stdio: 'inherit' });
  console.log('创建示例库：sample.sqlite');
}

function main() {
  ensureDir(EXT_DIR);
  ensureDir(SKILLS_DIR);
  ensureDir(CONNECTORS_DIR);
  ensureDir(LOCAL_EXT_DIR);

  const skillsEmpty = fs.readdirSync(SKILLS_DIR).length === 0;
  const connectorsEmpty = fs.readdirSync(CONNECTORS_DIR).length === 0;

  if (skillsEmpty || connectorsEmpty) {
    fetchAnthropicsSkills();
    installAnthropicsSkills();
  } else {
    console.log('extensions/skills 与 connectors 均已存在，跳过上游拉取');
  }

  createSelfSkills();
  createConnectors();
  createSampleSqlite();
  updateGitignore();

  console.log('T2 内容引入完成');
}

main();
