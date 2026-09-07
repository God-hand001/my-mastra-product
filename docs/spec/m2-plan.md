# M2 个人网盘 + 文档问答 Plan

> 输入:已批准的 [m2-spec.md](./m2-spec.md)

## 架构概览

```
前端 app/
  ├─ TaskInput "+"弹层(上传新文件 / 从网盘选择)
  │     ↓ 先上传 → 后端提取文本 → 前端拿全文
  │     ↓ 拼进首条消息文本(【附件:文件名】+ 全文)→ 发送
  ├─ AttachmentBar 附件条(文件名/大小/移除,最多 5 个)
  └─ DrivePage 网盘页(侧栏"个人网盘"入口:列表/删除/下载/上传)
        │ HTTP
Mastra server
  ├─ /drive/* 路由(上传/列表/删除/下载/取文本)
  ├─ drive-store 服务(存储+元数据+文本提取器)
  │     ├─ docx → mammoth │ pdf → pdf-parse │ xlsx → SheetJS 转 CSV
  │     └─ txt/md/csv/json → 直读
  └─ agent / chatRoute / Memory(不动)
storage/drive/           # 网盘目录(原件 + 元数据,gitignore)
```

**附件注入方式(核心取舍):前端中转全文** —— 前端上传 → 后端提取文本 → 前端把全文拼进首条消息再发送。备选"输入处理器注入"需在消息里塞自定义引用部件再异步替换,与 assistant-ui runtime 兼容风险高;中转方案零框架对抗,历史/上下文/存储自然工作。代价:历史多存一份全文(本地可接受)。

## 核心接口(后端 `/drive/*` 路由)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/drive/files` | multipart 上传;校验白名单(扩展名+MIME)、≤20MB、文件名清洗;响应直接带提取结果:`{ id, name, size, textChars, text, error? }` |
| GET | `/drive/files` | 文件列表:`[{ id, name, size, ext, uploadedAt }]` |
| GET | `/drive/files/:id/text` | 取提取文本(前端"从网盘选择"时用) |
| GET | `/drive/files/:id/download` | 下载原件 |
| DELETE | `/drive/files/:id` | 删除(原件+元数据) |

预算校验(F5):提取文本 > 30 万字符 → `error: '文件过大...'`,前端阻断发送。

## 模块设计

### 后端

| 模块 | 职责 |
|------|------|
| `src/mastra/services/drive-store.ts`(新建) | 网盘核心:`sanitizeName`(防路径穿越)、`saveFile`(存原件+写 meta.json)、`extractText`(按扩展名分发)、`listFiles` / `getFileText` / `deleteFile`;白名单校验与 20MB、30 万字符预算在此执行 |
| `src/mastra/server/drive-routes.ts`(新建) | 5 个 `registerApiRoute` 路由(Hono `c.req.parseBody()` 解析 multipart,零额外依赖) |
| `src/mastra/index.ts`(修改) | `server.apiRoutes` 挂载 drive 路由 |
| `src/mastra/agents/agent.ts`(微调) | instructions 补:"消息中【附件:xxx】段落是用户上传文档的全文,回答以它为准" |
| `.gitignore` | 加 `storage/` |

解析库:docx→**mammoth**;pdf→**pdf-parse**(打包异常则换 pdfjs-dist);xlsx→**xlsx@0.18**(SheetJS);其余直读。

### 前端

| 模块 | 职责 |
|------|------|
| `lib/driveClient.ts`(新建) | `uploadFile`(返回 meta 或 error)、`listFiles`、`getFileText`、`deleteFile`、`downloadUrl` |
| `components/AttachmentPicker.tsx`(新建) | "+"弹层:两页签「上传新文件」「从网盘选择」;最多 5 个 |
| `components/AttachmentBar.tsx`(新建) | 附件条:文件名 + 大小 + 移除按钮 |
| `routes/DrivePage.tsx`(新建) | 网盘页:上传按钮 + 文件列表(名称/大小/时间)+ 删除 + 下载 |
| `components/Sidebar.tsx`(修改) | 加"个人网盘"入口 |
| `routes/HomePage.tsx` + `components/TaskInput.tsx`(修改) | "+"接入弹层与附件条;提交时先上传 → 取文本 → 拼装含【附件】段落的首条消息 → 走现有 createTask/navigate 通道 |
| `styles/app.css`(修改) | 附件条/弹层/网盘页样式 |

## 模块交互

发送带附件的任务:TaskInput 选附件(上传或网盘选择)→ 提交时逐个 `uploadFile`(后端校验+提取,失败则阻断并提示)→ 前端把"【附件:name】+ 全文"拼进首条消息文本 → `createTask` + 跳转 → TaskPage 自动发出首条消息 → agent 基于全文回答(后续追问上下文自然延续)。

网盘页:挂载 `listFiles` → 渲染;删除/下载/上传直接调对应接口后刷新。

## 文件组织

```
my-mastra-product/
├── src/mastra/
│   ├── index.ts                 # 修改:挂载 /drive 路由
│   ├── agents/agent.ts          # 微调:instructions 附件说明
│   ├── services/drive-store.ts  # 新建:存储 + 提取器
│   └── server/drive-routes.ts   # 新建:HTTP 路由
├── storage/drive/               # 运行时生成(gitignore)
├── app/src/
│   ├── lib/driveClient.ts       # 新建
│   ├── components/
│   │   ├── AttachmentPicker.tsx # 新建
│   │   ├── AttachmentBar.tsx    # 新建
│   │   └── Sidebar.tsx          # 修改:网盘入口
│   └── routes/
│       ├── DrivePage.tsx        # 新建
│       ├── HomePage.tsx         # 修改
│       └── components TaskInput # 修改
└── docs/spec/m2-*.md
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 附件注入 | 前端中转全文 | 零框架对抗,链路可观测;历史多存一份全文本地可接受 |
| 解析库 | mammoth / pdf-parse(备选 pdfjs-dist) / xlsx@0.18 | 纯 JS 成熟库;pdf-parse 较老故留备选 |
| multipart 解析 | Hono 内置 `c.req.parseBody()` | 零额外依赖 |
| 附件范围 | 仅首页任务输入框;任务内 composer 属打磨期 | 首条注入后追问上下文已含全文;控制体量 |
| 存储 | `storage/drive/` 原件 + meta.json | 简单可手查;与 workspace 隔离(F6) |
| 校验 | 扩展名+MIME 双白名单、文件名清洗、20MB、30 万字符 | N2/N3/F5 |
