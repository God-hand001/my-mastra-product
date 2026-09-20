# M12 Codex 指令书 · 批 1（后端 diff）

你在这个仓库内工作（E:\agent_product\my-mastra-product）。按下面的任务顺序执行，不要做清单之外的任何事。

## 安全红线（必须遵守）

1. 只允许改动/新建本指令书列出的文件；禁止修改、删除、重命名任何其它文件
2. 禁止联网下载依赖（`diff` 已安装完毕，直接 import）
3. 禁止运行 dev server、禁止调用任何本地/远程服务
4. 禁止用 PowerShell 的 `Set-Content` 写含中文的文件（编码会坏）；用你自己的文件编辑工具或 Node `fs.writeFileSync(..., 'utf8')`
5. 每个任务做完跑一次编译验证：`npx tsc --noEmit`（在仓库根目录）

## 背景

M12 里程碑：Agent 执行过程可观测化。本批做后端部分——`project_write_file` 工具在写文件时计算行级 diff，随工具结果返回，供前端渲染改动差异。

## T2: 新建 `src/mastra/services/content-diff.ts`

diff 纯函数模块。要求：

1. 导出类型：

```ts
export interface DiffPayload {
  isNew: boolean;           // true = 写入前文件不存在
  hunks: Array<{ type: 'add' | 'del' | 'ctx'; text: string }>;  // 逐行,按原顺序,上下文行保留
  added: number;            // 新增行数
  removed: number;          // 删除行数
  truncated: boolean;       // 被截断
}
```

2. 导出 `computeContentDiff(oldStr: string | null, newStr: string): DiffPayload`：
   - `oldStr === null` → `isNew: true`，新内容全部行 type 为 add
   - 内部用 `diff` 包（`import { diffLines } from 'diff'`）计算，再把它的输出展开折叠为逐行 hunks（`added` 部分逐行 add、`removed` 部分逐行 del、`unchanged` 部分逐行 ctx）
   - **截断规则**：oldStr 或 newStr 任一超过 60,000 字符 → 不计算 diff，返回 `hunks: []`、`added: 0`、`removed: 0`、`truncated: true`、`isNew: oldStr === null`
   - 计算出的 hunks 超过 400 行 → 截断到 400 行，`truncated: true`（added/removed 按截断前统计）
   - 文件头部写中文注释：模块用途、截断规则、为何在后端算（结果落库，历史回放可见）
3. 空字符串边界：oldStr 为 `''`（存在但空文件）按普通内容处理（diffLines 语义），不视为新建；newStr 为 `''` 时结果是全部旧行 del

## T2 验证

写临时脚本 `verify-m12-diff.mjs`（仓库根，验证完保留，主 agent 复核后删）：

```js
// 用 node --experimental-strip-types 或纯 js 重写逻辑不行——直接 import 编译前的 ts 不便。
// 用这个方式:在脚本里 dynamic import diff 包复刻不合适。正确做法:
// 写完后运行: npx tsx verify-m12-diff.mjs 不可用时,改用 node --input-type=module -e 配合手动 build。
```

具体做法（二选一，以能跑通为准）：
- 首选：`npx tsx verify-m12-diff.mjs`（脚本里 `import { computeContentDiff } from './src/mastra/services/content-diff'`），断言 4 组用例：
  1. 新建：old=null，new='a\nb\n' → isNew=true、3 行 add、added=3
  2. 修改：old='a\nb\nc\n'，new='a\nX\nc\n' → 恰有一行 del('b') 一行 add('X')、added=1、removed=1
  3. 截断：new 为 60,001 字符 → hunks=[]、truncated=true
  4. 相同内容：old==='a\n'，new==='a\n' → hunks 全 ctx、added=0、removed=0
- 若 tsx 不可用：把断言逻辑放进临时 `.ts`，用 `npx tsc --noEmit` 过编译 + 走查代替运行，并在最终回复里说明哪个方式跑了

## T3: 修改 `src/mastra/tools/project-tools.ts`

只改 `projectWriteFileTool`（同文件内其它工具、safeJoin、activeProjectDir 一律不动）：

1. `outputSchema` 增加可选字段 `diff`（zod 结构与 DiffPayload 对齐：isNew boolean、hunks 数组（元素 {type: enum(['add','del','ctx']), text: string}）、added/removed number、truncated boolean）
2. `execute` 写入前：
   - `readFile(abs, 'utf-8')`，捕获异常且错误码为 `'ENOENT'` → oldStr = null；其它异常 → oldStr = null 且标记 `readFailed = true`
   - `computeContentDiff(oldStr, content)`；`readFailed` 时把返回值替换为 `{ isNew: oldStr === null, hunks: [], added: 0, removed: 0, truncated: true }`（注释写明：读旧内容失败不阻断写入，diff 降级）
   - 返回值并入 `diff` 字段（现有 `{path, bytes}` 保持不变）
3. 文件头注释补一行说明（中文）

## T3 验证

`npx tsc --noEmit` 通过。另在 verify-m12-diff.mjs 里追加：直接 import `projectWriteFileTool`，mock context（`{ requestContext: { get: () => undefined } }`）调用 execute，断言返回 `{error: '未选择项目…'}`（未选项目路径不受影响）。

## 汇报格式

完成后回复：改动文件列表、tsc 结果、验证脚本运行输出原文。不要自报「验证通过」以外的额外功能完成情况。
