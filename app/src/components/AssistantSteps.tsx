import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { parseArtifacts, stripArtifactMarkers, parseWebPages, stripWebPageMarkers, type Artifact, type WebPage } from '../lib/artifacts';
import { parseArtifactTags, stripArtifactTags, parseOpenArtifactTag, type ArtifactTag } from '../lib/artifactTag';
import { MarkdownText } from './MarkdownText';
import { ArtifactCard } from './ArtifactCard';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolCallCard, toolPhaseLabel } from './ToolCallCard';

// 当前会话角色的 artifactType,供 AssistantText 在 <artifact> 缺 type 属性时兜底(F12)。
// 用 Context 而不是 props:AssistantText 是通过 MessagePrimitive.PartByIndex 的
// components 配置渲染的,配置对象是模块级常量,渲染时机上组件拿不到外部 props,
// 只能靠 Context 从祖先节点传值。
export const RoleArtifactTypeContext = createContext<string | undefined>(undefined);

// 需要折叠到末尾的脚本类产物扩展名
const SCRIPT_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'ts', 'py', 'sh', 'ps1', 'bat']);

function isScriptArtifact(artifact: Artifact): boolean {
  const ext = artifact.name.split('.').pop()?.toLowerCase() ?? '';
  return SCRIPT_EXTENSIONS.has(ext);
}

// assistant 消息的"过程轻量、结果突出"渲染:
// 流式中只显示一行阶段文字,完成后把中间步骤折叠成"任务已完成 ›",正文只留最终答案。
//
// 这里不用 MessagePrimitive.Parts(它会渲染全部 part),而是用 PartByIndex 按索引挑选,
// 因为需要区分"中间步骤"和"最终答案",而 GroupedParts 的 groupBy 只能按相邻同类型合并,
// 表达不了"结尾那段文本才是答案"。

// 渲染 part 用的组件配置(折叠区展开后与改造前观感一致)
const PART_COMPONENTS = {
  Text: AssistantText,
  Reasoning: ReasoningBlock,
  tools: { Fallback: ToolCallCard },
} as const;

// 压缩上下文写回的摘要消息固定以此前缀开头(见 context-routes.ts 的 compress 端点),
// 前端据此加一个"历史摘要"角标,让用户看得出这条消息是压缩产物而不是模型的正常回复
// (之前完全没有视觉区分,压缩后旧消息消失、摘要混在普通气泡里,用户容易忽略压缩发生了)。
const HISTORY_SUMMARY_PREFIX = '【历史摘要】';

// 助手文本先清洗产物标记,再把标记转换成可点击的产物预览卡
function AssistantText({ text }: { text?: string }) {
  if (text === undefined) return <MarkdownText />;

  const roleArtifactType = useContext(RoleArtifactTypeContext);
  const isHistorySummary = text.startsWith(HISTORY_SUMMARY_PREFIX);
  const textWithoutSummaryPrefix = isHistorySummary ? text.slice(HISTORY_SUMMARY_PREFIX.length) : text;
  const artifactTags = parseArtifactTags(textWithoutSummaryPrefix, roleArtifactType);

  // M16-T9:检测到未闭合的 html 类型 artifact 标签时,自动展开画布标签,
  // 不必等标签闭合、也不必等用户手动点击。用 ref 记录已经为当前这条消息
  // dispatch 过一次,避免流式期间每个 token 到达都重复 dispatch。
  // 历史消息落库时标签必定已闭合(不会有"有开始没结束"的文本),所以这里
  // 天然只在真正流式生成中触发,不需要额外判断是否在流式状态。
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (artifactTags.length > 0) return; // 已闭合的走现有点击流程,不重复
    const open = parseOpenArtifactTag(textWithoutSummaryPrefix, roleArtifactType);
    if (open?.type !== 'html') return;
    autoOpenedRef.current = true;
    window.dispatchEvent(new CustomEvent('h0-open-artifact', {
      detail: { kind: 'artifact-tag', type: open.type, title: open.title, content: '' },
    }));
  }, [artifactTags.length, textWithoutSummaryPrefix, roleArtifactType]);
  const textAfterArtifactTags = stripArtifactTags(textWithoutSummaryPrefix);

  const artifacts = parseArtifacts(textAfterArtifactTags);
  const webPages = parseWebPages(textAfterArtifactTags);
  // 先清洗产物标记，再清洗网页标记；防御性过滤残留标记。
  const cleanedText = stripWebPageMarkers(stripArtifactMarkers(textAfterArtifactTags));
  const safeText = cleanedText.includes('产物:') || cleanedText.includes('网页:') ? '' : cleanedText;



  const openWebPage = (webPage: WebPage) => {
    window.dispatchEvent(new CustomEvent('h0-open-webpage', { detail: webPage }));
  };

  // 将产物分为脚本类(折叠)与其它(正常卡片),保持非脚本产物在前、脚本在后
  const scriptArtifacts = artifacts.filter(isScriptArtifact);
  const otherArtifacts = artifacts.filter(a => !isScriptArtifact(a));

  return (
    <>
      {isHistorySummary && <div className="history-summary-badge">⧉ 历史摘要（早期消息已压缩）</div>}
      {safeText && <MarkdownText text={safeText} />}
      {otherArtifacts.map(artifact => (
        <ArtifactCard key={artifact.path} artifact={artifact} />
      ))}
      {artifactTags.map((tag, i) => (
        <div
          key={`artifact-tag-${i}`}
          className="artifact-long-card"
          onClick={() => window.dispatchEvent(new CustomEvent('h0-open-artifact', {
            detail: { kind: 'artifact-tag', type: tag.type, title: tag.title, content: tag.content },
          }))}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('h0-open-artifact', {
                detail: { kind: 'artifact-tag', type: tag.type, title: tag.title, content: tag.content },
              }));
            }
          }}
        >
          <div className="artifact-long-card-head">
            <span className="artifact-icon" style={{ backgroundColor: tag.type === 'html' ? '#e34c26' : tag.type === 'slides' ? '#d24726' : '#4a5568' }}>
              {tag.type === 'html' ? '</>' : tag.type === 'slides' ? 'P' : 'D'}
            </span>
            <div className="artifact-info">
              <div className="artifact-name">{tag.title}</div>
              <div className="artifact-sub">{tag.type === 'html' ? '网页' : tag.type === 'slides' ? '幻灯片' : '文档'}</div>
            </div>
          </div>
        </div>
      ))}
      {scriptArtifacts.length > 0 && (
        <details className="artifact-scripts-fold">
          <summary>
            <span className="artifact-scripts-label">已生成 {scriptArtifacts.length} 个脚本</span>
            <span className="artifact-scripts-chev" aria-hidden="true">›</span>
          </summary>
          <div className="artifact-scripts-body">
            {scriptArtifacts.map(artifact => (
              <ArtifactCard key={artifact.path} artifact={artifact} />
            ))}
          </div>
        </details>
      )}
      <SourceBadge webPages={webPages} onOpen={openWebPage} />
    </>
  );
}

// 来源徽章:网页引用收进一个紧凑胶囊(如「15 个网页」),点击展开列表(2026-09-18 用户反馈)
// 站点圆徽章用域名首字 + 域名 hash 上色,不请求外部 favicon 服务(本地产品不出网)
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sourceHue(url: string): number {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) % 360;
  return h;
}

function SourceBadge({
  webPages,
  onOpen,
}: {
  webPages: WebPage[];
  onOpen: (webPage: WebPage) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (webPages.length === 0) return null;
  const stack = webPages.slice(0, 3);
  return (
    <div className="source-badge-wrap">
      <button
        type="button"
        className="source-badge"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span className="source-badge-stack" aria-hidden="true">
          {stack.map((w, i) => (
            <span
              key={w.url}
              className="source-badge-dot"
              style={{
                zIndex: 3 - i,
                marginLeft: i === 0 ? 0 : -7,
                background: `hsl(${sourceHue(sourceHost(w.url))} 52% 46%)`,
              }}
            >
              {(sourceHost(w.url).charAt(0).toUpperCase()) || '网'}
            </span>
          ))}
        </span>
        <span className="source-badge-count">{webPages.length} 个网页</span>
        <span className="source-badge-chev" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="source-badge-list">
          {webPages.map(w => (
            <button
              key={w.url}
              type="button"
              className="source-badge-item"
              onClick={() => onOpen(w)}
              title={w.url}
            >
              <span
                className="source-badge-item-dot"
                aria-hidden="true"
                style={{ background: `hsl(${sourceHue(sourceHost(w.url))} 52% 46%)` }}
              >
                {sourceHost(w.url).charAt(0).toUpperCase() || '网'}
              </span>
              <span className="source-badge-item-text">
                <span className="source-badge-item-name">{w.title}</span>
                <span className="source-badge-item-host">{sourceHost(w.url)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type PartLike = {
  type: string;
  result?: unknown;
  toolName?: string;
};

export type MessagePartsState = { message: { parts: readonly PartLike[] } };

// 最终答案的起始索引:从末尾往前跳过连续的 text part,遇到第一个非 text 即停。
// 返回 0 表示整条消息都是文本(纯闲聊,没有中间步骤)。
export function computeAnswerStart(parts: readonly PartLike[]): number {
  let i = parts.length;
  while (i > 0 && parts[i - 1].type === 'text') i--;
  return i;
}

// 流式阶段文字:按优先级反映当前实际阶段
export function computePhaseLabel(parts: readonly PartLike[]): string {
  // 1. 末尾向前找第一个无 result 的 tool-call(正在执行的工具)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === 'tool-call' && p.result === undefined) {
      return `${toolPhaseLabel(p.toolName ?? '')}…`;
    }
  }
  // 2. 最新 part 是 reasoning
  const last = parts[parts.length - 1];
  if (last?.type === 'reasoning') {
    return '正在思考…';
  }
  // 3. 末尾是 text(正在写最终答案)
  if (last?.type === 'text') {
    return '正在生成回复…';
  }
  // 4. 有 parts 但都不满足(已产出过内容但模型在决定下一步)
  if (parts.length > 0) {
    return '正在思考…';
  }
  // 5. 空 parts
  return '正在读你的问题…';
}

export function useAnswerBoundary() {
  const answerStart = useAuiState((s: MessagePartsState) => computeAnswerStart(s.message.parts));
  const partsCount = useAuiState((s: MessagePartsState) => s.message.parts.length);
  return { answerStart, partsCount };
}

// 判断当前 assistant 消息是否包含过程步骤(中间步骤或 reasoning/tool-call)
export function useHasProcessSteps(): boolean {
  return useAuiState((s: MessagePartsState) => {
    const parts = s.message.parts;
    if (computeAnswerStart(parts) > 0) return true;
    return parts.some(p => p.type === 'reasoning' || p.type === 'tool-call');
  });
}

// 流式中的轻量进度行(spinner + 阶段文字)
export function PhaseLine() {
  const label = useAuiState((s: MessagePartsState) => computePhaseLabel(s.message.parts));
  return (
    <div className="msg-phase">
      <span className="tool-card-spinner" />
      <span className="msg-phase-text">{label}</span>
    </div>
  );
}

// 中间步骤体(流式期间内联展开、结束后自动收起)
function StepsBody({ answerStart }: { answerStart: number }) {
  return (
    <div className="msg-steps-body">
      {Array.from({ length: answerStart }, (_, i) => (
        <MessagePrimitive.PartByIndex key={i} index={i} components={PART_COMPONENTS} />
      ))}
    </div>
  );
}

// 过程步骤折叠/展开控件:
// - 流式期间强制展开;结束后默认收起。
// - 用户手动展开优先;流式结束自动重置用户展开状态。
export function StepsFold({
  answerStart,
  isStreaming,
  label,
}: {
  answerStart: number;
  isStreaming: boolean;
  label?: string;
}) {
  const [userExpanded, setUserExpanded] = useState(false);
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      // 流式结束自动收起(用户手动展开会在下一次交互生效)
      setUserExpanded(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  return (
    <details
      className={`msg-steps${isStreaming ? ' is-streaming' : ''}`}
      open={isStreaming || userExpanded}
      onToggle={(e) => {
        // 内层 details(如深度思考卡)的 toggle 事件会冒泡到外层容器,
        // e.target 是内层元素——必须只处理自身的展开/收起,否则点收起内层
        // 思考卡时会把整个"任务已完成"折叠区一起收掉(2026-09-18 用户反馈)
        if (e.target !== e.currentTarget) return;
        if (!isStreaming) {
          setUserExpanded((e.target as HTMLDetailsElement).open);
        }
      }}
    >
      <summary>
        {/* 流式期间摘要行显示当前阶段词(spinner 样式由 .is-streaming 控制),完成后才显示"任务已完成" */}
        {isStreaming && <span className="tool-card-spinner" />}
        <span className="msg-steps-label">{label ?? (isStreaming ? '正在执行任务' : '任务已完成')}</span>
        <span className="msg-steps-chev">›</span>
      </summary>
      <StepsBody answerStart={answerStart} />
    </details>
  );
}

// 最终答案(结尾那段连续文本)
export function AnswerParts({
  answerStart,
  partsCount,
}: {
  answerStart: number;
  partsCount: number;
}) {
  return (
    <>
      {Array.from({ length: Math.max(0, partsCount - answerStart) }, (_, k) => {
        const index = answerStart + k;
        return (
          <MessagePrimitive.PartByIndex key={index} index={index} components={PART_COMPONENTS} />
        );
      })}
    </>
  );
}
