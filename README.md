# mastra-work

基于 [Mastra](https://mastra.ai) + TypeScript 实现的办公 Agent 产品：用户描述任务，Agent 调用工具执行并交付产物。

## 功能特性

- **办公文档生成**：Word（docx.js 脚本直出）、PPT（pptxgenjs）、Excel（openpyxl + 公式重算校验），产物落工作区并在右侧预览栏渲染
- **Windows 沙箱**：所有子进程经 codex 沙箱围栏执行（写限制 / 拒读敏感文件 / 断网），越界操作需用户审批提权
- **扩展体系**：内置技能（docx / pptx / 前端设计 / EDA 等）与 MCP 连接器，面板一键启停
- **场景角色**：通用 / 设计师 / 幻灯片 / 写作四类角色，各有独立提示词与技能白名单
- **自定义模型**：「我的模型」页接入任意 OpenAI 兼容网关，对话栏即选即用
- **任务协作**：待办清单面板、上下文用量统计与手动压缩、定时任务、网盘与项目系统

## 环境要求

- Node.js ≥ 22.13（含 npm）
- Windows 10/11（沙箱与文档生成链路依赖 Windows 特性）
- 首次安装依赖需要联网

## 首次准备

**一键配置（推荐）**：

```shell
npm install       # 先装根依赖(为运行 setup 脚本本身)
npm run setup
```

脚本会自动完成:三处依赖安装、`.env` 生成、Python 与 codex 沙箱运行时就位、沙箱管理员初始化（会弹一次 UAC 提权窗口，点"是"即可）、内置扩展配置。全程幂等，中断后重跑会跳过已完成步骤。

**API Key 说明**：不填 `.env` 也可以用——启动后进入「我的模型」页接入你自己的 OpenAI 兼容网关（自带 apiKey），对话与文档生成即正常工作，只是内置的三个 DeepSeek 模型不可用。但 **`TAVILY_API_KEY`（联网搜索）没有界面可配，只能通过 `.env` 填写**；不填则搜索类任务会提示未配置。

**手动逐步配置**（一键脚本某步失败时按此排查）：

```shell
# 1. 安装三处依赖
npm install
cd app && npm install && cd ..
cd app-desktop && npm install && cd ..

# 2. 配置 API Key:复制 .env.example 为 .env 并填入真实 key
#    DEEPSEEK_API_KEY   DeepSeek 官方 API
#    TAVILY_API_KEY     Tavily 联网搜索(免费注册)
copy .env.example .env

# 3. 就位 Python 运行时(vendor/python,文档生成依赖,国内镜像可直连)
node scripts/setup-python-runtime.mjs

# 4. 就位 codex 沙箱运行时(vendor/codex)
node scripts/setup-sandbox-runtime.mjs

# 5. 沙箱 elevated 档一次性初始化(需管理员 PowerShell,仅执行一次)
#    把 <项目根> 替换为实际路径
vendor\codex\bin\codex.exe sandbox setup --elevated --current-user --codex-home <项目根>\.sandbox-home

# 6. 内置技能与连接器配置(如 extensions/ 目录已存在可跳过)
node scripts/setup-extensions.mjs
```

## 启动

### 1. 启动后端（必须先启动，端口 4111）

```shell
npm run dev
```

### 2. 桌面端（推荐）

```shell
cd app-desktop
npm run desktop        # 加载 app/dist 构建产物
```

桌面端启动时会自动探测后端：后端未就绪时显示提示页，每 3 秒自动重连。

**桌面端开发模式**（前端改动实时热更新，需先另开终端跑着 `cd app && npm run dev`）：

```shell
cd app-desktop
npm run desktop:dev    # 加载 http://localhost:5173
```

### 3. 浏览器访问（不装桌面壳也可以用）

```shell
cd app
npm run build     # 构建(桌面端非 dev 模式也依赖此步的产物)
npm run dev       # 开发服务器,浏览器打开 http://localhost:5173
```

### 4. 打 Windows 安装包（NSIS 安装器）

```shell
cd app-desktop
npm run dist      # 自动先构建前端,产物在 app-desktop/release/
```

## 沙箱排错（新机器最常见）

`vendor/` 目录（300MB 运行时）**不在仓库里**，克隆后必须按顺序执行"首次准备"的第 3、4、5 步。两个典型报错：

| 报错关键字 | 原因 | 解法 |
|---|---|---|
| `未找到沙箱运行时` / `vendor\codex\bin\codex.exe 不存在` | 没跑下载脚本 | `node scripts/setup-sandbox-runtime.mjs` |
| `沙箱 elevated 档未完成初始化` / `缺少 setup_marker.json` | codex 下载好了，但没做管理员初始化 | **管理员** PowerShell 里执行下面这条 |

管理员初始化（`Win + X` → 选"终端(管理员)"，`cd` 到项目根后执行）：

```powershell
vendor\codex\bin\codex.exe sandbox setup --elevated --current-user --codex-home <项目根>\.sandbox-home
```

这条命令做什么：在 Windows 里创建一个专用的受限本地账户（需要管理员权限，因为建账户和打 ACL 是管理员操作），之后 agent 的所有命令与脚本都以该账户运行，实现"只能写工作区 / 拒读 .env 与凭据 / 默认断网"三重隔离；`.sandbox-home` 是它的凭据与标记目录（已 gitignore，不入库）。

**临时绕过**（仅本地调试，会失去拒读与断网隔离）：设环境变量 `MEW_SANDBOX_LEVEL=restricted-token` 后启动后端。

Python 文档生成链路同理：报 `未找到 Python 运行时` 就先跑 `node scripts/setup-python-runtime.mjs`。

## 目录结构

| 路径 | 说明 |
|---|---|
| `src/mastra/` | 后端：Agent 定义、工具（文档生成/搜索/沙箱）、HTTP 路由、服务层 |
| `app/` | 前端：React + Vite，对话界面、预览面板、扩展/模型管理页 |
| `app-desktop/` | 桌面壳：Electron，加载前端产物并转发 API 请求 |
| `extensions/` | 内置技能与 MCP 连接器（面板可启停） |
| `vendor/` | 运行时（Python / codex 沙箱），由 setup 脚本生成，不入库 |
| `docs/spec/` | 各里程碑（M0–M17）的 spec / plan / task / checklist 文档 |

## 安全说明

- Agent 的所有命令与脚本在受限沙箱内执行：只能读写工作区、默认断网、无法读取 `.env` 与凭据文件；越界操作需用户在界面上审批提权
- `.env` 已被 `.gitignore` 排除，不会进入版本库；请勿在代码中硬编码 API Key
- 请勿将该服务直接暴露到公网未鉴权使用
