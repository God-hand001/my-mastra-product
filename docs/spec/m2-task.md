# M2 个人网盘 + 文档问答 Tasks

> 输入:[m2-spec.md](./m2-spec.md) + [m2-plan.md](./m2-plan.md)
> 前置:M0/M1 已验收;后端 dev server 与前端 dev server 运行约定同 M0

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/mastra/services/drive-store.ts` | 网盘存储 + 文本提取器 |
| 新建 | `src/mastra/server/drive-routes.ts` | /drive/* HTTP 路由 |
| 修改 | `src/mastra/index.ts` | 挂载 drive 路由 |
| 修改 | `src/mastra/agents/agent.ts` | instructions 附件说明 |
| 修改 | `.gitignore` | 加 storage/ |
| 新建 | `app/src/lib/driveClient.ts` | 网盘 HTTP 客户端 |
| 新建 | `app/src/components/AttachmentPicker.tsx` | 附件选择弹层 |
| 新建 | `app/src/components/AttachmentBar.tsx` | 附件条 |
| 修改 | `app/src/components/Sidebar.tsx` | 网盘入口 |
| 修改 | `app/src/components/TaskInput.tsx` | "+"附件能力 |
| 修改 | `app/src/routes/HomePage.tsx` | 提交时上传并拼装首条消息 |
| 新建 | `app/src/routes/DrivePage.tsx` | 网盘页 |
| 修改 | `app/src/App.tsx` / `main.tsx` | 路由 /drive |
| 修改 | `app/src/styles/app.css` | 新组件样式 |

## T1: 后端 drive-store(存储 + 提取器)

**文件:** `src/mastra/services/drive-store.ts`(新建)、`.gitignore`
**依赖:** 无
**步骤:**
1. `npm install mammoth pdf-parse xlsx`(项目根)
2. 实现 `sanitizeName`(去路径分隔符与控制字符,保留中文名)、`ensureDir`
3. `saveFile(buffer, originalName)`:生成 id(uuid)、写入 `storage/drive/<id>/original.<ext>` 与 `meta.json`(id/name/size/ext/uploadedAt);校验:扩展名白名单(txt/md/csv/json/docx/pdf/xlsx)、≤20MB
4. `extractText(id)`:按 ext 分发 → 直读(utf-8)/ mammoth.extractRawText / pdf-parse(buffer)/ xlsx 转 CSV;文本 > 300_000 字符 → 返回 `{ error: '文件过大...' }`;解析异常 → `{ error: '解析失败:原因' }`(N1)
5. `listFiles()`(读各 meta.json,按时间倒序)、`getFileText(id)`(优先缓存提取结果到 meta)、`deleteFile(id)`(删目录)
6. `.gitignore` 加 `storage/`

**验证:** `node --experimental-strip-types` 自测脚本(在根目录,set -a source .env 不需要):构造小 docx?(手工用之前生成的嘉立创 docx 复制进来)—— 用 saveFile + extractText 跑 docx/pdf/xlsx/txt 四种文件,确认文本提取与错误分支;跑完删除测试数据。后端 dev server 启动无报错

## T2: 后端 /drive 路由

**文件:** `src/mastra/server/drive-routes.ts`(新建)、`src/mastra/index.ts`
**依赖:** T1
**步骤:**
1. `registerApiRoute` 定义 5 个路由(见 plan 接口表);上传用 `c.req.parseBody()` 取 File
2. `src/mastra/index.ts` 的 `server.apiRoutes` 数组加入 drive 路由
3. 注意:上传响应里带 `text`(前端中转方案),下载路由用 Hono 流式响应带 Content-Disposition

**验证:** curl 自测:POST 上传一个 docx(响应含 text 与 textChars)、GET 列表、GET text、GET download(bin 相等)、DELETE 后列表消失;错误分支:上传 .png → 415/明确错误

## T3: 前端附件流

**文件:** `app/src/lib/driveClient.ts`、`components/AttachmentPicker.tsx`、`components/AttachmentBar.tsx`、`components/TaskInput.tsx`、`routes/HomePage.tsx`、`styles/app.css`
**依赖:** T2
**步骤:**
1. `driveClient.ts`:五个方法封装(fetch 即可)
2. `TaskInput`:props 增加 attachments 状态(由 HomePage 持有);"+"按钮触发 AttachmentPicker;AttachmentBar 展示已选;提交逻辑改为:若带附件 → 逐个 uploadFile(显示处理中)→ 失败则 alert/提示并停止 → 全部成功后把"【附件:name】\n<text>"段落与用户输入拼为首条消息文本
3. `AttachmentPicker`:两页签(上传新文件 = input[type=file] multiple;从网盘选择 = listFiles 列表点选);已选满 5 个禁用
4. `HomePage`:持有 attachments 状态并传给 TaskInput;提交流程如上

**验证:** 浏览器:首页"+"上传 docx → 附件条出现 → 提交 → 任务页首条消息含全文(agent 回答引用内容);上传 png → 明确提示

## T4: 网盘页

**文件:** `app/src/routes/DrivePage.tsx`、`components/Sidebar.tsx`、`App.tsx`、`main.tsx`(路由)
**依赖:** T2
**步骤:**
1. DrivePage:上传按钮 + 列表(名称/大小/上传时间)+ 每行删除/下载;空状态"网盘还是空的,上传一个文件试试"
2. Sidebar 增加"个人网盘"入口(图标 + 文案,路由 /drive)
3. 路由注册 /drive;样式

**验证:** 浏览器:页内上传 → 列表刷新;删除 → 消失;下载 → 文件可打开;侧栏入口可达

## T5: instructions 附件说明

**文件:** `src/mastra/agents/agent.ts`
**依赖:** T3
**步骤:** instructions 增加一条:"消息中的【附件:文件名】段落是用户上传文档的全文,回答相关问题时以附件内容为准;附件内容不足以回答时明确说明"

**验证:** dev server 热重载无报错;附件问答正常

## T6: 按 checklist 验收

**文件:** `docs/spec/m2-checklist.md`(阶段四生成)
**依赖:** T5
**步骤:** 阶段六执行:逐项运行 checklist(AC1~AC9),记录证据,出验收报告

## 执行顺序

```
T1 → T2 → T3、T4(可并行)→ T5 → T6
```
