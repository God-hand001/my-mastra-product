// <artifact> 标签协议解析:角色约束模型把交付产物放进 <artifact> 标签,
// 前端从对话流中剥离该标签内容,转换成产物卡送右侧预览,而不是把原始标签
// 内容(可能是几十 KB 的 HTML)直接显示在聊天气泡里。
export interface ArtifactTag {
  type: 'html' | 'slides' | 'doc';
  title: string;
  content: string;
  raw: string; // 完整匹配到的原始标签文本,用于从正文里剔除
}

// type 属性可能缺失(F12:模型没按格式输出 type 时,由调用方按当前角色 artifactType 补齐)。
// 非贪婪 + dotAll(s 标志)让 . 能匹配换行,支持多行 HTML 内容;g 标志支持多实例。
const ARTIFACT_TAG_PATTERN = /<artifact(?:\s+type="([^"]*)")?\s+title="([^"]*)"\s*>([\s\S]*?)<\/artifact>/g;

const VALID_TYPES = new Set(['html', 'slides', 'doc']);

// fallbackType:当标签缺 type 属性时用什么类型兜底(通常是当前会话角色的 artifactType)
export function parseArtifactTags(text: string, fallbackType?: string): ArtifactTag[] {
  const results: ArtifactTag[] = [];
  for (const match of text.matchAll(ARTIFACT_TAG_PATTERN)) {
    const rawType = match[1];
    const resolvedType = VALID_TYPES.has(rawType ?? '') ? rawType : fallbackType;
    if (!resolvedType || !VALID_TYPES.has(resolvedType)) continue; // 无法确定类型的标签跳过,不渲染成产物卡(F13 兜底)
    results.push({
      type: resolvedType as ArtifactTag['type'],
      title: match[2].trim(),
      content: match[3],
      raw: match[0],
    });
  }
  return results;
}

// 从正文中剔除已解析的 artifact 标签,剩余部分按普通 Markdown 渲染
export function stripArtifactTags(text: string): string {
  return text.replace(ARTIFACT_TAG_PATTERN, '').trim();
}


// 未闭合标签兜底解析(M16-T7):流式生成过程中,</artifact> 还没吐出来时,
// parseArtifactTags 返回空数组——画布组件拿不到任何"进行中"的内容。
// 这个函数专门处理这种情况:只要求 <artifact ... title="..."> 起始标签出现,
// 把从起始标签到文本末尾的内容都当作"目前已生成的部分"返回。
// 只在 parseArtifactTags 返回空、且怀疑正在流式生成时调用,不影响已闭合标签的正常路径。
const OPEN_ARTIFACT_TAG_PATTERN = /<artifact(?:\s+type="([^"]*)")?\s+title="([^"]*)"\s*>([\s\S]*)$/;

export interface OpenArtifactTag {
  type: 'html' | 'slides' | 'doc';
  title: string;
  content: string;
}

// fallbackType 同 parseArtifactTags;返回 null 表示当前文本里没有检测到未闭合的 artifact 标签
export function parseOpenArtifactTag(text: string, fallbackType?: string): OpenArtifactTag | null {
  // 已经闭合的标签不归这个函数处理,避免同一段内容被两条路径重复识别
  if (text.includes('</artifact>')) return null;
  const match = text.match(OPEN_ARTIFACT_TAG_PATTERN);
  if (!match) return null;
  const rawType = match[1];
  const validTypes = new Set(['html', 'slides', 'doc']);
  const resolvedType = validTypes.has(rawType ?? '') ? rawType : fallbackType;
  if (!resolvedType || !validTypes.has(resolvedType)) return null;
  return {
    type: resolvedType as OpenArtifactTag['type'],
    title: match[2].trim(),
    content: match[3],
  };
}
