import { useEffect, useRef, useState } from 'react';
import type { AssistantRuntime } from '@assistant-ui/react';
import { parseArtifactTags, parseOpenArtifactTag } from '../lib/artifactTag';

interface DesignWorkspaceProps {
  title: string;
  content: string; // 完整网页 HTML(标签已闭合时的最终内容,兜底值)
  runtime?: AssistantRuntime;
}

// design 产物的多标签工作区(对齐千问 design 模式的 5 标签壳:画布/设计文件/预览/
// 风格参考/计划,但只做标签壳本身——不做可交互画布工具(选中/拖拽/标注)、
// 不做设计文件的独立管理、不做风格参考的自动抓取。这些是用户看过千问实机截图
// 后明确选择"先只加标签壳"的范围(2026-09-20),画布工具与设计文件管理等后续
// 视需要再单独排期。

// 拼接一条 assistant 消息的纯文本(message.content 是 part 数组,取 type==='text' 的 text 拼接)
function extractAssistantText(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('');
}

// 生成过程中轮询最新的 assistant 消息文本,尝试解析出"目前已生成的部分" html 内容,
// 用于画布 tab 的实时刷新(M16-T8)。轮询而非真正的流式 patch——当前架构下
// (<artifact> 整体标签,不是文件系统事件驱动)这是改动最小、风险最低的路径,
// 代价是 iframe srcDoc 整页重刷、未闭合半截 HTML 可能渲染报错(用户已知悉此代价)。
function useLiveArtifactContent(runtime: AssistantRuntime | undefined, fallbackContent: string): string {
  const [liveContent, setLiveContent] = useState(fallbackContent);
  const lastLenRef = useRef(fallbackContent.length);

  useEffect(() => {
    if (!runtime) return;
    const poll = () => {
      try {
        const state = runtime.thread.getState();
        const lastAssistant = [...state.messages].reverse().find(m => m.role === 'assistant');
        if (!lastAssistant) return;
        const text = extractAssistantText(lastAssistant as any);
        // 优先取已闭合的标签内容(生成已完成,内容最终且稳定)
        const closed = parseArtifactTags(text, 'html')[0];
        const candidate = closed ? closed.content : parseOpenArtifactTag(text, 'html')?.content;
        if (!candidate) return;
        // 内容变化且增长超过阈值才刷新,避免每次轮询都重渲染整个 iframe 造成闪烁
        if (candidate.length > lastLenRef.current + 200 || (closed && candidate !== liveContent)) {
          lastLenRef.current = candidate.length;
          setLiveContent(candidate);
        }
      } catch {
        // runtime 状态异常时保持上一次内容,不中断轮询
      }
    };
    poll();
    const timer = setInterval(poll, 800);
    return () => clearInterval(timer);
  }, [runtime]);

  return liveContent;
}

export function DesignWorkspace({ title, content, runtime }: DesignWorkspaceProps) {
  const [tab, setTab] = useState<'canvas' | 'files' | 'preview' | 'style' | 'plan'>('canvas');
  const liveContent = useLiveArtifactContent(runtime, content);

  return (
    <div className="design-workspace">
      <div className="design-workspace-tabs">
        <button type="button" className={tab === 'canvas' ? 'is-active' : ''} onClick={() => setTab('canvas')}>画布</button>
        <button type="button" className={tab === 'files' ? 'is-active' : ''} onClick={() => setTab('files')}>设计文件</button>
        <button type="button" className={tab === 'preview' ? 'is-active' : ''} onClick={() => setTab('preview')}>预览</button>
        <button type="button" className={tab === 'style' ? 'is-active' : ''} onClick={() => setTab('style')}>风格参考</button>
        <button type="button" className={tab === 'plan' ? 'is-active' : ''} onClick={() => setTab('plan')}>计划</button>
      </div>
      {tab === 'canvas' && (
        <div className="design-canvas">
          <iframe
            className="design-canvas-iframe"
            srcDoc={liveContent}
            sandbox="allow-scripts allow-forms"
            title={title}
          />
        </div>
      )}
      {tab === 'files' && (
        <div className="design-tab-placeholder">
          <div className="design-file-row">
            <span className="design-file-icon" aria-hidden="true">{'</>'}</span>
            <span className="design-file-name">{title}.html</span>
          </div>
          <p className="design-placeholder-hint">当前只有一个页面文件;后续如产出多文件产物会在此列出。</p>
        </div>
      )}
      {tab === 'preview' && (
        <div className="design-canvas">
          <iframe
            className="design-canvas-iframe"
            srcDoc={liveContent}
            sandbox="allow-scripts allow-forms"
            title={`${title}-预览`}
          />
        </div>
      )}
      {tab === 'style' && (
        <div className="design-tab-placeholder">
          <p className="design-placeholder-hint">
            风格决策依据本轮对话中读取的前端设计技能方法论,以及你在结构化提问中给出的方向;
            暂不做独立的可视化风格参考卡片。
          </p>
        </div>
      )}
      {tab === 'plan' && (
        <div className="design-tab-placeholder">
          <p className="design-placeholder-hint">
            执行计划以待办清单形式呈现,可在右栏「任务监控」标签查看实时进度。
          </p>
        </div>
      )}
    </div>
  );
}
