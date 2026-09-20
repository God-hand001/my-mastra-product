// 内容差异计算模块
// 用途：为 project_write_file 工具计算写入前后的行级差异
// 截断规则：
//   1. oldStr 或 newStr 任一超过 60,000 字符时，不计算 diff，返回空 hunks 且 truncated=true
//   2. 计算出的 hunks 超过 400 行时，截断到 400 行，truncated=true
// 在后端计算原因：diff 结果会随工具调用结果落库，支持历史回放时查看每次改动的差异。

import { diffLines } from 'diff';

export interface DiffPayload {
  isNew: boolean;           // true = 写入前文件不存在
  hunks: Array<{ type: 'add' | 'del' | 'ctx'; text: string }>;  // 逐行，按原顺序，上下文行保留
  added: number;            // 新增行数
  removed: number;          // 删除行数
  truncated: boolean;       // 是否被截断
}

const MAX_DIFF_CHARS = 60_000;
const MAX_DIFF_LINES = 400;

export function computeContentDiff(oldStr: string | null, newStr: string): DiffPayload {
  const isNew = oldStr === null;

  // 超长内容直接截断，避免 diff 计算占用过多内存与时间
  if ((oldStr !== null && oldStr.length > MAX_DIFF_CHARS) || newStr.length > MAX_DIFF_CHARS) {
    return { isNew, hunks: [], added: 0, removed: 0, truncated: true };
  }

  const oldText = oldStr === null ? '' : oldStr;
  const changes = diffLines(oldText, newStr, { newlineIsToken: true });

  const hunks: DiffPayload['hunks'] = [];
  let added = 0;
  let removed = 0;

  for (const change of changes) {
    if (!change.value) continue;
    // diffLines(newlineIsToken) 返回的 value 按换行拆分即可得到逐行结果
    const lines = change.value.split('\n');
    for (const line of lines) {
      if (change.added) {
        hunks.push({ type: 'add', text: line });
        added++;
      } else if (change.removed) {
        hunks.push({ type: 'del', text: line });
        removed++;
      } else {
        hunks.push({ type: 'ctx', text: line });
      }
    }
  }

  const truncated = hunks.length > MAX_DIFF_LINES;
  const finalHunks = truncated ? hunks.slice(0, MAX_DIFF_LINES) : hunks;

  return { isNew, hunks: finalHunks, added, removed, truncated };
}