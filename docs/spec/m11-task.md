# M11 沙箱体系 Tasks

> 对应 `m11-spec.md` + `m11-plan.md`(均已批准)。
> **✅ 全部 18 个任务已完成并通过验收(2026-09-17),验收报告见 `m11-验收报告.md`,清单勾选见 `m11-checklist.md`(48/49,N9 需非 Windows 环境)。**
> Phase 1 的 `sandbox-runtime.ts` 已建成(冒烟 15/15),本文覆盖 Phase 2 与 Phase 3。
>
> **两条测试纪律**(Phase 0 交过学费,每个验证步骤都适用):
> 1. 每条「应被拒」必须配一条**同形式**的「应成功」;两者都失败说明命令没执行,拒绝断言无效。
> 2. 真拒绝的特征:stderr 含 `PermissionError: [Errno 13]`(Python)或 `Access is denied.`(cmd);
>    若见「文件名、目录名或卷标语法不正确」,那是语法错误伪装的假阳性。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/mastra/services/sandbox-runtime.ts` | 增 `PermissionTier` / `tierPolicyOptions` / `prewarmSandbox` |
| 新建 | `src/mastra/services/codex-sandbox.ts` | `LocalSandbox` 子类,劫持命令包裹点 |
| 新建 | `src/mastra/services/sandbox-approval.ts` | 档位解析 / 拒绝计数 / 审批编排 |
| 新建 | `src/mastra/server/approval-routes.ts` | 待决审批查询 + 决定回传 |
| 修改 | `src/mastra/tools/xlsx-build.ts` | 换沙箱执行;删正则黑名单 |
| 修改 | `src/mastra/tools/html-to-docx.ts` | 换沙箱执行;任务文件挪进写根 |
| 修改 | `src/mastra/tools/html-to-pptx.ts` | 同上 |
| 修改 | `src/mastra/services/connector-runtime.ts` | 启动命令经沙箱 + 网络按连接器 |
| 修改 | `src/mastra/agents/agent.ts` | 用 `CodexSandbox`;关自动批准;补拒绝语义 |
| 修改 | `src/mastra/index.ts` | 启动自检 + 预热 + 挂审批路由 |
| 修改 | `app/src/components/PermissionSelect.tsx` | 导出档位读取函数(现仅写 localStorage,无人读) |
| 新建 | `app/src/components/SandboxApprovalCard.tsx` | 审批卡片 |
| 修改 | `app/src/lib/transport.ts` | requestContext 携带档位 |
| 修改 | `app/src/components/ChatThread.tsx` | 渲染审批卡片 + 回传决定 |
| 修改 | `extensions/connectors/*/connector.json` | 联网类连接器加 `network` 字段 |
| 新建 | `scripts/diag-connector-startup.mjs` | T9 定量测量,用完删 |
| 新建 | `scripts/spike-suspend.mjs` | T12 A/B 实验,用完删 |

---

# Phase 2:子进程接管

## T1: 立回归基线

**文件：** 无(只读运行)
**依赖：** 无
**步骤：**
1. 运行 `vendor/python/python.exe scripts/verify_m7_converter.py`,记录通过数
2. 运行 `vendor/python/python.exe scripts/verify_m8_pptx.py`,记录通过数
3. 运行 `vendor/python/python.exe scripts/verify_m9_xlsx.py`,记录通过数
4. 运行 `npx tsc --noEmit`,确认改动前类型干净
5. 把四个结果写进本文件末尾的「基线记录」小节

**验证：** 三个脚本分别达到 27/27、28/28、24/24;tsc 无输出。**若基线本身不绿,先修基线再开工** —— 否则后面分不清是谁弄坏的。

## T2: 运行时模块增量

**文件：** `src/mastra/services/sandbox-runtime.ts`
**依赖：** T1
**步骤：**
1. 导出 `export type PermissionTier = 'default' | 'full'`(定义在此以保证依赖单向:approval → runtime)
2. 新增 `tierPolicyOptions(tier)`:`'default'` 返回空对象;`'full'` 返回 `{ extraWriteRoots: [整盘根], allowNetwork: true }`。整盘根取项目所在盘符根目录,不用 `special:root`(那是读语义)
3. 新增 `prewarmSandbox()`:调一次最轻量的沙箱命令(如 `cmd.exe /c echo warm`),用默认 `workspace-write` 策略(**必须与后续真实调用同一策略**,否则预热的访问控制项集合不匹配、等于没热),返回 `{ ok, elapsedMs, message }`,失败不抛异常
4. `sandboxPreflight()` 的返回信息补上档位与拒读条数(已有,确认格式可读)

**验证：** `npx tsc --noEmit` 干净;临时脚本调 `prewarmSandbox()` 打印 `elapsedMs`,再调一次,第二次明显更快(冷启动已被吃掉)。

## T3: 新建沙箱子类

**文件：** `src/mastra/services/codex-sandbox.ts`
**依赖：** T2
**步骤：**
1. `class CodexSandbox extends LocalSandbox`,构造参数 `{ workingDirectory, extraWriteRoots?, resolveTier? }`
2. 构造时向 `super()` 传 `isolation: 'none'`(Windows 上传其他值会被框架构造函数拒绝),`super()` 返回后改写 `this.isolation` 为哨兵值 `'codex-windows'` —— 使 execa 走 `shell:false` 数组直传;**不可用 `'seatbelt'`**(会进 macOS 分支)
3. 覆盖 `wrapCommandForIsolation(command)`:调 `buildShellWrapperArgv(command, { policy, policyOptions })`,返回 `{ command: exe, args: argv }`
4. 策略选取:基础 `workspace-write` + `extraWriteRoots`;若传了 `resolveTier` 且返回 `'full'`,并入 `tierPolicyOptions('full')`
5. 类顶部注释写明为何**不替换 `processes`**:框架把 `executeCommand` 做成捕获构造期进程管理器的闭包,事后替换会留静默漏洞

**验证：** `npx tsc --noEmit` 干净;临时脚本构造实例后调 `wrapCommandForIsolation('echo x')`,断言返回的 command 是沙箱二进制路径且 args 含 `--run-as-windows-sandbox`。

## T4: 表格建表工具接沙箱

**文件：** `src/mastra/tools/xlsx-build.ts`
**依赖：** T2
**步骤：**
1. 把执行建表脚本与执行重算的两处 `execFileAsync` 换成 `sandboxedExecFile`,策略 `workspace-write`
2. 删除 `FORBIDDEN_PATTERNS` 常量与 `checkScriptSecurity` 函数,以及调用它的分支(AC2)。在原处留一行注释说明:内容黑名单已由内核级围栏取代
3. 保留 `safeOutputPath` 与 `refDirFor`(纵深防御,D9)
4. 错误分流:`deniedBySandbox` 为真时返回「被沙箱拒绝 + 原因」措辞;否则沿用现有「脚本执行失败」措辞
5. 移除因删除黑名单而不再使用的 import

**验证：** `npx tsc --noEmit` 干净;`grep -n "FORBIDDEN_PATTERNS\|checkScriptSecurity" src/mastra/tools/xlsx-build.ts` 无输出;临时脚本直调工具 execute,传一段写工作区内的建表脚本 → 产物存在;传一段 `open()` 写工作区外的脚本 → 返回 `ok:false` 且 error 含拒绝原因、文件未生成。

## T5: Word 转换器接沙箱

**文件：** `src/mastra/tools/html-to-docx.ts`
**依赖：** T2
**步骤：**
1. 任务文件目录从 `mkdtemp(path.join(tmpdir(), 'html2docx-'))` 改为工作区内点前缀目录(如 `<workspace>/.mew-convert/html2docx-<随机>`),用 `mkdir(..., {recursive:true})` 创建 —— 沙箱身份写不进用户临时目录(F3)
2. 相应移除 `tmpdir` import;保留现有 `finally` 里的 `rm(taskDir, {recursive:true,force:true})` 清理
3. 执行转换器的 `execFileAsync` 换成 `sandboxedExecFile`,策略 `workspace-write`
4. 错误分流同 T4:`deniedBySandbox` 为真时措辞区分

**验证：** `npx tsc --noEmit` 干净;临时脚本直调工具,传一份最小 HTML(含 `<section>` 与 `doc-footer` meta)→ 返回 `success:true` 且 .docx 存在;确认用户临时目录下无 `html2docx-*` 残留(检查 `%TEMP%`)。

## T6: PPT 转换器接沙箱

**文件：** `src/mastra/tools/html-to-pptx.ts`
**依赖：** T2
**步骤：** 与 T5 完全同构(目录名用 `html2pptx-`),逐条对应执行

**验证：** 同 T5,传一份含两个 `data-layout` 的 HTML → .pptx 存在;`%TEMP%` 无 `html2pptx-*` 残留。

## T7: agent 接入沙箱子类

**文件：** `src/mastra/agents/agent.ts`
**依赖：** T3
**步骤：**
1. `new LocalSandbox({...})` 换成 `new CodexSandbox({ workingDirectory: workspacePath, resolveTier })`
2. 保留现有的 `hooks.beforeToolCall` 兜底超时与 `requireReadBeforeWrite` / `requireApproval` 工具配置 —— 沙箱是加一层(D9)
3. instructions 里补一段沙箱语义:命令与脚本在受限环境执行,只能写工作区;遇到「被沙箱拒绝」时说明原因并调整方案,不要反复重试同一被拒操作
4. **本任务不动 `autoResumeSuspendedTools`** —— 它必须与前端审批界面同批交付(D8/R2),留到 T17

**验证：** `npx tsc --noEmit` 干净;`node scripts/spike-mastra-sandbox.mjs` 仍 7/7(该脚本用自己的子类,验证接法未失效);启动 `npm run dev`,发一条要求执行命令的真实对话,后端日志显示命令经沙箱二进制执行。

## T8: 启动自检与预热

**文件：** `src/mastra/index.ts`
**依赖：** T2
**步骤：**
1. 在现有 `refreshConnectors()` 预热之前,调 `sandboxPreflight()` 并把结果写入启动日志
2. 预检失败时打印明确错误与修复命令(不中断启动 —— 让用户能进产品看到提示,而非黑屏)
3. 预检成功则 `void prewarmSandbox().then(r => log(r.message))`,不阻塞启动
4. 挂上 `approvalRoutes`(T14 建好后补;本任务先留 import 位置的注释)

**验证：** `npm run dev` 启动日志出现「沙箱就绪: elevated 档 | codex-home=… | 拒读路径 N 条」;把 `vendor/codex/bin/codex.exe` 临时改名后重启,日志出现明确错误与修复命令且服务仍能启动;改回名字。

## T9: 连接器启动开销定量

**文件：** `scripts/diag-connector-startup.mjs`(新建,用完删)
**依赖：** T2
**步骤：**
1. 固定拒读集合(用 `buildPolicy` 的默认集合,不额外传 `extraDenyRead`),对同一个本地连接器连续启动 4 次并记录各次 `initialize` 往返耗时
2. 加一组对照:同样 4 次但不经沙箱
3. 再加一组:两个连接器**并发**启动,记录总耗时,与顺序启动对比 —— 验证跨进程命名互斥体 `Local\CodexSandboxReadAcl` 是否让并发失效(D6)
4. 输出结论:首次 vs 后续均值、并发是否有加速

**验证：** 脚本跑完输出三组数据。据此在本文件「D6 结论」小节写明选定的启动策略(并发预热 或 懒启动),再执行 T10。

## T10: 连接器接沙箱

**文件：** `src/mastra/services/connector-runtime.ts`
**依赖：** T9
**步骤：**
1. `buildClient()` 里构造 `servers[c.name]` 时,把 `{command, args}` 改写成经沙箱形态:调 `buildWrapperArgv({ command, args, policy: 'workspace-write', policyOptions })`,用返回的 `exe` 作 command、`argv` 作 args
2. 读连接器清单的可选字段 `network`(缺省 `restricted`),映射到 `policyOptions.allowNetwork`
3. 按 T9 结论调整启动策略(并发预热或懒启动)
4. 保留现有的 `${ROOT}` / `${PY}` 占位符替换与错误中文化 —— 占位符替换必须在包裹**之前**完成

**验证：** `npx tsc --noEmit` 干净;启动服务后在扩展面板启用一个本地连接器,发对话让 agent 调用其工具 → 成功返回;把某连接器命令改成不存在的可执行文件 → 面板显示失败原因、其他连接器仍可用。

## T11: 连接器能力声明与审批门(用户 2026-09-16 定向)

**文件：** `extensions/connectors/*/connector.json`、`scripts/setup-extensions.mjs`
**依赖：** T10
**背景(实测结论,见文末「T10/T11 实测」)：** 8 个连接器分两类。4 个 Python 类(fetch/git/sqlite/time)代码已在本地磁盘,进沙箱无障碍。4 个 npx 类(everything/filesystem/memory/sequential-thinking)用 `npx -y <包名>` 启动 —— 那是个下载器,启动时要**联网下载**并**写工作区外的 npm 缓存**,正是沙箱拦的两件事。

**用户定向**:连接器的额外能力需求走**弹窗询问、人工审核后放行**,不由沙箱单方面拒绝。
**时机选择**:审批放在**扩展面板启用连接器时**,而非首次工具调用时 —— 连接器在服务启动阶段拉起(`index.ts` 的 `refreshConnectors()`),那时没有对话窗口;而用户本来就是在面板点开关的,问在那一刻时机自然,且不必把连接器改成懒启动。批准后**持久记住**,不反复问。

**步骤：**
1. `connector.json` 增加可选字段 `capabilities`,声明该连接器需要的额外能力:
   - `"network": true` —— 需要联网
   - `"externalWrite": ["<绝对路径>"]` —— 需要写工作区外的目录
2. 按职责逐个声明:`fetch` 声明 `network`(其职责即 HTTP 抓取);4 个 npx 类声明 `network` + npm 缓存目录的 `externalWrite`;其余不声明
3. 同步改 `setup-extensions.mjs` 的连接器生成清单(`createConnectors()`,第 286 行是 `if (existsSync(dest)) continue`,故已存在的目录不会被覆盖,但**新装机器会生成不带声明的配置**)
4. `connector-runtime.ts` 读 `capabilities`:未获批准的能力需求 → 该连接器**不启动**,面板显示「需要授权:联网 / 写外部目录」;已获批准 → 按声明放宽策略
5. 审批状态的读写接口由 T13 的审批服务提供;本任务只负责声明与门控,**门控在审批机制就位前一律拒绝**(fail-closed)

**验证：** 启用一个声明了 `network` 的连接器 → 面板提示需要授权且连接器未启动;授权后(T16 就位)连接器启动、其工具可调用;未声明能力的连接器不受影响、正常启动可用。

**⚠️ 一个未解决的权衡(需后续决策)：** 给 npx 类开网络,只是为了让它下载自己的代码 —— filesystem/memory/sequential-thinking 的功能本身**完全不需要网络**(读本地文件、存图谱、推理链)。为解决「代码不在本地」这个打包问题而授予永久网络权限,代价与收益不匹配。**建议另立任务**:把这 4 个包装进 `package.json`,连接器改用 `node <入口路径>` 直启 —— 与 `setup-python-runtime.mjs` 把 Python 包装进 vendor 的做法同构,两个能力需求同时消失,且真正满足 N5 离线要求。该建议与本任务的审批机制不冲突:审批用于**真正需要网络的**连接器(fetch),本地安装让另外三个根本无需申请。

---

# Phase 3:逃生通道

## T12: 审批链路 A/B 实验

**文件：** `scripts/spike-suspend.mjs`(新建,用完删)
**依赖：** T2
**步骤：**
1. 造一个最小 Mastra agent,挂一个自定义工具,该工具在执行中途尝试挂起并携带载荷
2. 关闭 `autoResumeSuspendedTools`,观察:工具是否真的挂起、载荷能否被外部读到、能否用决定数据恢复
3. 记录结论:设计 A(中途挂起)是否可用于普通 agent 工具
4. 若 A 不可用,验证设计 B:一个挂 `requireApproval: true` 的独立「请求提权」工具,在关闭自动批准后是否走到审批闸门

**验证：** 脚本输出「A 可用」或「A 不可用,B 可用」。据此在本文件「⑥ 结论」小节写明选定设计,再执行 T13。**两条路都要求 T17 与前端同批交付。**

## T13: 审批服务模块

**文件：** `src/mastra/services/sandbox-approval.ts`
**依赖：** T12
**步骤：**
1. 从 `sandbox-runtime.ts` 导入 `PermissionTier`(依赖单向)
2. `resolveTier(requestContext)`:读 `requestContext.get('permission')`,仅接受 `'default'` / `'full'`,其他一律 `'default'`(fail-closed)
3. `recordDenial(key)`:进程内 Map 计数,返回 `{count, exhausted}`;`exhausted` 阈值取 2(与转换器重试上限一致);带 TTL 清理
4. `requestApproval(req)`:生成 `approvalId`,存入待决 Map,返回 Promise;设超时(如 120s)到点 resolve 为 `{type:'denied'}`
5. `resolveApproval(approvalId, decision)`:兑现对应 Promise,返回是否命中
6. `isSessionApproved(threadId, key)` / 批准时写入会话批准集
7. 全部状态进程内,不落盘(D7);模块顶部注释写明理由:跨重启的待决审批一律视为拒绝

**验证：** `npx tsc --noEmit` 干净;临时脚本:`requestApproval` 后立即 `resolveApproval(id, {type:'approved'})` → Promise 兑现为 approved;另起一个不 resolve 的,等超时 → 兑现为 denied;`recordDenial` 同 key 调三次 → 第三次 `exhausted:true`。

## T14: 审批接口路由

**文件：** `src/mastra/server/approval-routes.ts`(新建)
**依赖：** T13
**步骤：**
1. `GET /sandbox/approvals?threadId=` 返回该线程的待决审批列表(不含策略 JSON 等内部细节)
2. `POST /sandbox/approvals/:approvalId` 收决定 `{type, rejection?}`,校验 type 取值后调 `resolveApproval`
3. 未知 `approvalId` 返回 404;非法 type 返回 400
4. 沿用现有路由文件的 `registerApiRoute` 写法与中文错误信息风格
5. 在 `index.ts` 的 `apiRoutes` 数组挂上(补完 T8 留的位置)

**验证：** 启动服务;用临时脚本触发一个待决审批,`curl` GET 接口能看到它;POST 一个 `approved` 决定 → 返回成功且工具恢复执行;POST 未知 id → 404。

## T15: 前端档位接线

**文件：** `app/src/components/PermissionSelect.tsx`、`app/src/lib/transport.ts`
**依赖：** T13
**步骤：**
1. `PermissionSelect.tsx` 导出 `loadPermission()`(现为模块内私有),供外部读取当前档位
2. 调用方(`ChatThread` / `TaskPage` 等 `getRequestContext` 的实现处)在返回对象里加 `permission: loadPermission()`
3. 确认 `transport.ts` 的现有 `getRequestContext?.()` 机制会把它带上(与模型/技能/项目目录同构,D10)
4. 档位切换时立即生效 —— 因为每条消息都重新读 localStorage,无需额外通知机制

**验证：** `cd app && npx tsc --noEmit` 干净;浏览器切到「完全访问权限」,发一条消息,后端日志打印收到的 `requestContext.permission` 为 `full`;切回默认档,日志为 `default`。

## T16: 审批卡片

**文件：** `app/src/components/SandboxApprovalCard.tsx`(新建)、`app/src/components/ChatThread.tsx`
**依赖：** T14
**步骤：**
1. 卡片展示:工具名、将执行的命令、工作目录、被拒原因、请求放宽的范围
2. 四个按钮对应四种决定:本次允许 / 本会话允许 / 拒绝但继续 / 拒绝并停止
3. 点击后 POST 到审批接口,期间禁用按钮防重复提交
4. `ChatThread` 在检测到待决审批时渲染卡片(轮询或复用现有流事件通道,取现有实现更省的一条)
5. 样式沿用现有卡片类(参考 `ToolCallCard` 的视觉),不新造设计语言

**验证：** `cd app && npx tsc --noEmit` 干净;浏览器里让 agent 执行一个越界写操作 → 出现审批卡片且内容完整;点「本次允许」→ 操作成功完成;再触发一次 → 再次询问(证明未被误记为会话批准)。

## T17: 关闭自动批准

**文件：** `src/mastra/agents/agent.ts`
**依赖：** T15 + T16(两者都必须先完成)
**步骤：**
1. 移除 `defaultOptions` 里的 `autoResumeSuspendedTools: true` —— 实测其语义为**自动批准**,不关则审批形同虚设(R2/D8)
2. 在该处留注释写明:关闭前 `requireApproval` 一直被静默自动批准
3. 检查现有挂了 `requireApproval` 的工具(删除类)在关闭后是否走到审批界面
4. **本任务必须与 T16 同批提交** —— 单独关闭会导致缺界面时永久挂起

**验证：** 启动服务,让 agent 尝试删除工作区内一个文件 → 出现审批卡片(而非静默执行);点拒绝 → agent 报告未执行;确认没有工具永久挂起(观察是否有请求卡住不返回)。

## T18: 回归复跑

**文件：** 无(只读运行)
**依赖：** T1–T17 全部完成
**步骤：**
1. 重跑 T1 的三个断言脚本与 `npx tsc --noEmit`
2. 重跑 `scripts/smoke-sandbox-runtime.ts`(按其文件头的编译方式)
3. 重跑 `scripts/spike-sandbox.mjs`、`spike-mastra-sandbox.mjs`、`spike-elevated.mjs`
4. 与 T1 记录的基线逐项比对
5. 删除临时脚本 `diag-connector-startup.mjs`、`spike-suspend.mjs`、`spike-mcp-stdio.mjs`

**验证：** 三个断言脚本与基线一致;冒烟 15/15;三个 spike 分别 6/6、7/7、7/7;tsc 干净。任何一项低于基线即为回归,先修再进验收。

---

## 执行顺序

```
T1(基线)
 │
 ├─→ T2(运行时增量) ─┬─→ T3(沙箱子类) ─→ T7(agent 接入)
 │                  ├─→ T4(表格工具)
 │                  ├─→ T5(Word 转换器)
 │                  ├─→ T6(PPT 转换器)
 │                  ├─→ T8(启动自检)
 │                  ├─→ T9(连接器定量) ─→ T10(连接器接沙箱) ─┐
 │                                    T11(能力声明+审批门)←─┴─ 需 T13 的审批状态接口
 │                  └─→ T12(A/B 实验) ─→ T13(审批服务) ─┬─→ T14(路由) ─→ T16(卡片) ─┐
 │                                                     └─→ T15(前端档位) ────────┴─→ T17(关自动批准)
 └────────────────────────────────────────────────────────────────────────────────→ T18(回归)
```

**可并行组**:T4 / T5 / T6 / T8 彼此独立(都只依赖 T2);T9 与 T12 两条调查线可并行。
**强制串行**:T16 → T17 不可颠倒也不可拆开提交(D8)。
**两个决策门**:T9 出结论才做 T10;T12 出结论才做 T13。

---

## 基线记录

> T1 已执行(2026-09-16),T18 比对用。

| 项目 | 基线 | T18 实测 |
|---|---|---|
| `verify_m7_converter.py` | **27/27** 通过,退出码 0 | |
| `verify_m8_pptx.py` | **28/28** 通过,退出码 0 | |
| `verify_m9_xlsx.py` | **24/24** 通过,退出码 0 | |
| 根 `npx tsc --noEmit` | 无输出,退出码 0 | |
| `app/` `npx tsc --noEmit` | 无输出,退出码 0 | |

⚠️ **跑断言脚本必须先设 `PYTHONIOENCODING=utf-8`**。否则脚本末尾打印 ✅ 时会在中文 Windows 控制台抛
`UnicodeEncodeError: 'gbk' codec can't encode character '✅'`,**断言本身已全部通过但退出码非零** ——
T18 若按退出码判断会误判为回归。这是脚本的既有缺陷,与 M11 改动无关,本次不修(不属本 spec 范围)。

## D6 结论(T9 已执行,2026-09-16)

实测(`scripts/diag-connector-startup.ts`,停掉 dev server 后跑,用产品模块的 `buildWrapperArgv` 保证拒读集合与真实调用一致):

| 项目 | 数值 |
|---|---|
| 裸跑稳态(不经沙箱) | 1.2s |
| 沙箱稳态 | **1.9s** |
| 沙箱增量 | **0.8s** |
| 沙箱首次(已预热后) | 2.1s |
| 并发 2 个 vs 顺序 2 个 | 3.6s → 2.3s,**加速 1.59×** |
| 不带 `PYTHONUNBUFFERED` | 可正常完成 initialize,**无需额外环境变量** |

**⚠️ 推翻了 plan 中 R1 记录的 13.8s**:那次是 spike 自己手搓策略、**未传拒读集合**,与磁盘上已应用的集合不一致 → 触发访问控制项重写(即 D5 的抖动效应)。真实增量仅 0.8s。
因此 plan 中「8 个连接器顺序预热约两分钟」的担忧**不成立**:8 × 1.9s ≈ 15s,并发后更短。

**选定策略:保留现有的启动预热**(`index.ts` 已调 `refreshConnectors()`),不改为懒启动。
并发度由 `@mastra/mcp` 的 MCPClient 内部控制(它在 `listToolsWithErrors()` 里连接各服务器),不在本项目代码里;实测加速 1.59× 说明并发确有效果,但那是它的行为,T10 不做额外并发编排。

## ⑥ 结论(T12 已执行,2026-09-16 晚,接手会话)

`scripts/spike-suspend.mjs` **6/6 通过**(真实 LLM 驱动,LibSQL 独立临时库):

| 组 | 断言 | 结果 |
|---|---|---|
| A1 | suspend 型工具真的挂起,外部能读 `suspendPayload` | ✅ |
| A2 | `resumeStream({approved:true},{runId})` 后工具真正执行 | ✅ |
| B1 | `requireApproval` 工具停在审批闸门,execute 未跑 | ✅ |
| B2 | `approveToolCall` 后工具执行 | ✅ |
| C1 | `declineToolCall(带 reason)` 后工具未执行,流程收尾 | ✅ |
| D1 | **`autoResumeSuspendedTools=true` 时 `requireApproval` 工具仍停在闸门** | ✅ |

**裁定:**
1. **设计 A、B 都可用**。逃生通道选 **A(suspend)**:沙箱拒绝发生在工具执行中途,只有 A 能携带(命令、拒绝原因、请求放宽范围)载荷挂起;B(requireApproval)是执行前闸门,无法表达「跑了一半被沙箱拦下」。现有删除类工具继续用 B(已是产品现状),审批 UI 两种 chunk 都要渲染。
2. **T17 的前提修正**:任务书原记录「autoResumeSuspendedTools 的语义为自动批准」**不成立**(D1 反证,且与框架内嵌文档 L396 一致)。但**仍要关闭它**:数据型 suspend 流会把用户下一条自然语言消息自动解析成 resumeData(「好的」→ approved:true),绕过审批卡片。决定权必须只在卡片。
3. **T13 设计大幅简化(基于框架能力,替代自建审批 Map)**:待决审批的存储与发现用框架的 `agent.listSuspendedRuns({threadId, resourceId})`(LibSQL 持久化,跨重启可恢复);决定回传用 `approveToolCall / declineToolCall(reason) / resumeStream`。自建服务只保留框架没有的三件:`resolveTier`、`recordDenial`(拒绝计数熔断)、会话批准集(`isSessionApproved`)。T14 路由挂 `GET /sandbox/approvals?threadId=`(包装 listSuspendedRuns,隐藏内部细节)+ `POST /sandbox/approvals/:runId`(分发到三种决定方法)。

**spike 伪缺陷记录**:首版 B 组用挂双工具的 agent,deepseek-v4-flash 在双工具场景下不发起调用 —— 与审批机制无关,单工具对照 agent 复测即过。

## ⚠️ 运维发现:双 codex-home 并发 → 沙箱账户锁定(2026-09-16 17:47 事故)

**现象**:codex exec 子代理中途所有命令报 `CreateProcessWithLogonW failed: 1909`(账户锁定);产品 dev server 也可能受影响。

**机制**(来自 `.sandbox-home/.sandbox/sandbox.2026-09-16.log`):
1. codex.exe 每次 spawn 都可能做 **"setup refresh"**(spawn 前的 setup 二进制调用,通常只刷 ACL 不轮换密码;marker/用户「missing or incompatible」时才 **ensuring sandbox users** → **轮换账户密码**)
2. 17:47:03 dev server 因文件热重启 → `prewarmSandbox()` spawn → 项目 home(`.sandbox-home`)refresh + 轮换密码 → 写**项目 home** 的 DPAPI 库
3. 17:47:37 并发运行的 codex exec(用 `~/.codex` home)也 refresh + 轮换 → 写**用户 home** 的 DPAPI 库
4. 两个 home 共享同一对 `CodexSandboxOffline/Online` 账户但**各存一份凭据** → 后一次轮换把前一个 home 的凭据作废 → 双方 spawn 登录全失败 → 锁定阈值(10 次)打满 → 1909

**规避纪律**(夜间自主运行与今后协同都适用):
- **串行化**:codex exec 运行期间不跑 dev server(其沙箱 spawn 会触发项目 home refresh);验证窗口开服务,验完即停
- **验证 codex exec 指向项目 home**(`--codex-home .sandbox-home`):单凭据库根除分裂脑(需确认 auth 可用)——若可行则成为常态
- 锁定 10 分钟自动解除(本机策略:阈值 10 / 持续 10 分钟);解除后下一次 spawn 的 refresh 会自愈(重新轮换并写入自己的库)
- 此问题与 M11 代码无关,是 codex CLI 的多 home 共账户设计使然;若后续复现频繁,考虑产品与 CLI 合并单一 codex-home

**另**:T10 验证时 dev server 首次硬崩(无日志退出)与此无关(发生在任何锁定之前),维持「实例交替脏状态」判定,继续观察。

## T13/T14 验证记录(2026-09-16 深夜,接手会话)

架构按「⑥ 结论」落地:`sandbox-approval.ts`(resolveTier/recordDenial/会话批准集/elevationKey)+ `sandbox-elevation.ts`(suspend 型提权工具)+ `approval-routes.ts`(GET/POST /sandbox/approvals)+ 指令纪律更新。**运行时验证全绿**:

| 场景 | 结果 |
|---|---|
| 删除类(requireApproval)挂起可见、文件未被静默删除 | ✅ |
| 批准删除 → 文件真实删除 | ✅ |
| 越界写被拒 → agent 自动调用提权工具 → 挂起载荷含命令与原因 | ✅ |
| 批准提权 → full 档重跑 → 工作区外文件真实写入 | ✅ |
| 拒绝提权 → 外部文件未写,agent 收到拒绝原因 | ✅ |
| 会话批准(mode='session')→ 同线程同类操作免审批直接执行;新线程重新询问 | ✅ |
| 未知 runId → 404 | ✅ |

**过程中修复的两个缺陷**:
1. **MCPClient 泄漏(潜在,M10 起就有)**:`buildClient` 在 `listToolsWithErrors` 抛出时不清理已创建实例,静态注册表的"同配置重复初始化"防护会把后续所有重建卡死(聊天接口 500)。修复:`new MCPClient({id:'connector-runtime',…})` + 异常路径 disconnect。
2. **listSuspendedRuns 返回形状**:框架返回 `{runs,total}` 而非数组,路由初版直接当数组迭代会 TypeError,review 时修正为解构。

**⚠️ 提权后重复执行(2026-09-17 用户实测发现并修复)**:提权获批后命令已由工具代为执行,但模型不知情,续跑时会**再执行一遍** —— 对追加(`>>`)、计数等非幂等命令会写入两次(用户实测出现重复行)。双重修复:① agent instructions 增加"获批后不得再自行执行原命令,只做只读校验";② 工具返回值增加 `note` 字段直接把该约束摆在模型眼前(比只靠 instructions 可靠)。复验:追加命令提权后文件恰为 2 行(非 3 行),模型续文明确"只做只读校验,不重复写入"。

**语义备注(验收时留意)**:熔断计数把每次挂起请求也计入(拒绝一次 + 一次重试即达阈值 2),比任务书字面「拒绝两次」更保守,方向是 fail-closed(少打扰用户);如需放宽到"两次明确拒绝后才熔断",把 `sandbox-elevation.ts` 挂起路径里的 `recordDenial` 挪到仅 resume 后的未批准分支即可,一行改动。

## T10/T11 实测(2026-09-16)

**连接器分两类,问题只在后一类:**

| 类别 | 连接器 | 启动方式 | 沙箱内 |
|---|---|---|---|
| Python 类 | fetch / git / sqlite / time | `vendor/python` 跑已装在磁盘的包 | 无障碍 |
| npx 类 | everything / filesystem / memory / sequential-thinking | `npx -y <包名>` | 需额外能力 |

**npx 类的失败链(逐步定位):**
1. 内层写 `npx` → `CreateProcessAsUserW failed: 2(找不到文件)`。Windows 上 `npx` 是 `npx.cmd` 批处理,且裸名无 PATH 查找
2. 内层给 `npx.cmd` 全路径 → `uv_os_homedir returned ENOMEM`。libuv 取用户主目录读 `USERPROFILE`,而 `buildChildEnv` 刻意最小化(N4)未含它
3. 补 `USERPROFILE`/`APPDATA`/`LOCALAPPDATA` + 用 `cmd.exe /c` 包装 + **放行网络** + **npm 缓存目录可写** → **成功**,拿到完整 `initialize` 响应(带 capabilities,非模糊匹配)

**⚠️ 未隔离最小必需集**:上述成功是四项让步一起给的,没有逐项排除。若后续要精确到最小集合,需再测。

**根因**:`npx -y <包名>` 本质是下载器 —— 启动时联网取包、写 `%LOCALAPPDATA%\npm-cache`(工作区外),正是沙箱拦的两件事。

**顺带暴露的既有问题**:spec 的 N5 要求离线可用,而这 4 个连接器一直是启动时联网下载 —— 无网即起不来。该矛盾在接沙箱前就存在,只是未被触发。

**测量过程中的自我纠错**(记录以免重犯):
- 首版诊断脚本用 `spawn` 直接执行 `npx`,`shell:false` 下不能执行 `.cmd` → 脚本自身 ENOENT,非产品问题
- 一版判定式写成 `/usage|server|stdio/i.test(输出)`,而包名 `server-everything` 本身含 "server" → **假阳性**。改为必须收到含 `"result"` 与 `protocolVersion`/`serverInfo` 的 `initialize` 响应才算成功
- 一轮测量三项全 `code=null` 且输出为空 → 那是**未做握手就判超时**,空输出无法区分「启动失败」与「已就绪等 stdin」,结论作废

## T10 验证记录(2026-09-16,接手会话复核)

1. tsc 干净(交接确认);2. 真实对话(POST /chat/agent)→ agent 成功调用 `time` 连接器的 `get_current_time`,返回上海时区准确时间;3. 失败路径实测:4 个 npx 类连接器 fail-closed(`CreateProcessAsUserW failed: 2`,与任务书「命令不存在」同路径),中文原因落面板 lastError,4 个 Python 类正常,互不影响。

⚠️ 一次**未复现**的硬崩:旧 dev server 被强杀后立刻起新实例,首个聊天请求令新实例无日志退出(HTTP 监听消失、进程残留)。干净重启后同一请求 200 通过,判定为**新旧实例交替脏状态**(疑似旧实例沙箱子进程残留),非代码问题。T18 回归若复现再查。教训:重启 dev server 前先确认 4111 无监听、无残留 node 进程。

**T11 实现决策补充**:`externalWrite` 用 `${NPMCACHE}` 占位符(运行时解析为 `%LOCALAPPDATA%\npm-cache`),而非任务书字面的「绝对路径」—— 语义等价(解析后即绝对路径),且避免把机器路径写死进仓库,与既有 `${ROOT}/${PY}` 占位符惯例一致。

## T11 验证记录(2026-09-16 晚,接手会话)

1. 根 + app tsc 干净;2. **门控生效**:声明联网的 5 个连接器「需要授权:联网」落面板、不启动;未声明的 git/sqlite/time 不受影响;3. **授权放行**:POST authorize fetch → `{"ok":true,"granted":["network"]}`,连接器启动、错误清除、授予持久化进注册表;4. **fetch 工具真实可用**:agent 经沙箱连接器抓取 example.com 成功;5. **npx 修正生效**:memory 授权后经「npx.cmd 全路径 + cmd.exe /c + USERPROFILE 三变量 + 网络 + npm 缓存写根」完整链路启动成功;6. **非法授予被拒**:对未声明能力的 git/time POST authorize → 400 中文报错。

⚠️ **过程事故(已修复)**:子代理首轮把 4 个 connector.json 的 `externalWrite` 值写成**空字符串**(PowerShell 编码事故的连带损伤),空路径写根导致 codex 解析器拒收整个 profile(`failed to parse permission profile: did not match any variant`)—— 表象是 memory 连接器「Connection closed」。二分定位(探针构造 profile 实测 codex.exe)排除了 npm-cache 写根��身、cmd.exe 引号、环境变量等假设后,读 connector.json 原始字符码找到空串。**教训:排查 profile 解析失败先检查写根路径是否为空串/被截断**;子代理的文件写入必须人工核对原始字节。

⚠️ 另:authorize 接口对**空 body**(无 Content-Type)会报「Unexpected end of JSON input」而非按「授予全部已声明」处理 —— 小瑕疵,前端传 `{}` 可绕开,留待 T16 联调时顺手修。
