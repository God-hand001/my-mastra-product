import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { API_BASE } from '../lib/apiBase';
import { useLocation, useParams } from 'react-router-dom';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';
import { parseArtifacts, parseWebPages, type Artifact, type WebPage } from '../lib/artifacts';
import { attachmentSection, createTaskTransport, LOCAL_USER_RESOURCE } from '../lib/transport';
import { PreviewPanel, rememberRecentTab, type PreviewTab } from '../components/PreviewPanel';
import { type RawMastraMessage } from '../components/TaskMonitor';
import { loadSelectedModel, saveSelectedModel } from '../lib/models';
import { toUIMessages, type MastraMessage } from '../lib/messages';
import { ChatThread } from '../components/ChatThread';
import { HomePage } from '../routes/HomePage';
import { AttachmentPicker } from '../components/AttachmentPicker';
import type { PickedAttachment } from '../lib/driveClient';
import { linkThread, type Project } from '../lib/projectsClient';

const AGENT_ID = 'agent';

type PreviewSyncMessage =
  | { type: 'request-payload'; tabId: string }
  | { type: 'payload'; tabId: string; tab: PreviewTab; threadId: string }
  | { type: 'zoom'; tabId: string; zoom: number }
  | { type: 'window-closed'; tabId: string };

// 轮询等待某个条件成立;超时返回 false(不抛错,调用方据此决定是否继续)
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

// 从历史 UIMessage 提取纯文本,用于全量恢复历史产物标签
function getUIMessageText(message: UIMessage): string {
  return message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}

// 任务视图外壳:先拉历史,就绪后才挂载聊天(保证 runtime 以完整历史初始化,F4)
export function TaskPage({ projects }: { projects: Project[] }) {
  const { id = '' } = useParams();
  const location = useLocation();
  const initialMessage = (location.state as { initialMessage?: string } | null)?.initialMessage;

  const [boot, setBoot] = useState<{ messages: UIMessage[] } | null>(null);
  // 任务监控面板用它解析 signal / toolInvocation 等原始字段（toUIMessages 会过滤掉 signal）。
  const [rawMessages, setRawMessages] = useState<RawMastraMessage[]>([]);
  const workspaceSinceRef = useRef<number>(Date.now());
  // 工作文件时间窗口起点:取线程首条消息的落库时间(持久、跨刷新稳定)。
  // 之前用组件挂载时刻(Date.now()):刷新或重进会话后,窗口起点变成"刷新那一刻",
  // 任务期间产生的工作文件全部落在窗口之外,工作文件区永远显示"暂无"(2026-09-18 用户实测)。
  const syncWorkspaceSince = useCallback((messages: MastraMessage[]) => {
    const first = messages[0]?.createdAt;
    const t = first ? Date.parse(first) : NaN;
    if (Number.isFinite(t)) workspaceSinceRef.current = t;
  }, []);
  // 审批决定次数:决定后续写的是**同一条** assistant 消息(历史条数不变),
  // 仅靠消息数变化不足以触发重挂载 —— 计数器保证每次决定后必然重挂载,
  // 让模型接下来的输出立即可见(2026-09-17 用户反馈:点击后要手动刷新)。
  const [approvalReloadCount, setApprovalReloadCount] = useState(0);

  const reloadHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/memory/threads/${id}/messages?agentId=${AGENT_ID}&resourceId=${encodeURIComponent(LOCAL_USER_RESOURCE)}&page=0&perPage=100`,
      );
      if (!res.ok) throw new Error(`加载历史失败: ${res.status}`);
      const data = (await res.json()) as { messages?: MastraMessage[] };
      setBoot({ messages: toUIMessages(data.messages ?? []) });
      setRawMessages(data.messages ?? []);
      syncWorkspaceSince(data.messages ?? []);
      setApprovalReloadCount(c => c + 1);
    } catch (err) {
      console.error('审批后刷新历史失败', err);
    }
  }, [id, syncWorkspaceSince]);

  // 重新生成期间暂停历史刷新:新回复入库(数量 +1)与旧回复删除(数量 -1)之间存在窗口,
  // 若此时轮询命中,下方的 key 会变化并把 TaskChat 整个重挂,页面会闪一下两条回复。
  // 用计数器而非布尔值:清理请求未返回时用户再次点 ↻,先完成的那次不会提前解除暂停。
  const pendingRegenRef = useRef(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | undefined;

    // 后台定时任务通过 Mastra signal 唤醒线程时，结果会先进入线程 stream。
    // 订阅该 stream 后再刷新 memory，页面才能在任务对话中自动显示 assistant 回复。
    const refreshSoon = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void loadMessages(false);
      }, 300);
    };

    const loadMessages = async (showLoading: boolean) => {
      // 重新生成进行中:跳过后台刷新(首次加载 showLoading=true 不受此限制)
      if (!showLoading && pendingRegenRef.current > 0) return;
      if (showLoading) setBoot(null);
      try {
        // 线程同时按 agentId 和 resourceId 区分；定时任务使用 local-user，
        // 缺少 resourceId 时接口会返回空消息，导致已执行的结果在页面不可见。
        const res = await fetch(
          `${API_BASE}/api/memory/threads/${id}/messages?agentId=${AGENT_ID}&resourceId=${encodeURIComponent(LOCAL_USER_RESOURCE)}&page=0&perPage=100`,
        );
        if (!res.ok) throw new Error(`加载历史失败: ${res.status}`);
        const data = (await res.json()) as { messages?: MastraMessage[] };
        if (alive) setBoot({ messages: toUIMessages(data.messages ?? []) });
        if (alive) setRawMessages(data.messages ?? []);
        syncWorkspaceSince(data.messages ?? []);
      } catch (err) {
        // 后端未启动或线程尚未创建:退化为空历史,不白屏
        console.error('加载任务历史失败', err);
        if (alive) setBoot({ messages: [] });
        if (alive) setRawMessages([]);
      }
    };


    void loadMessages(true);
    // 定时任务在后台执行，页面没有对应的流式请求；轮询让结果像办公助手一样自动出现。
    timer = setInterval(() => void loadMessages(false), 3_000);

    // subscribe 接口是长连接：空闲时保持连接，定时 signal 到达后会推送事件。
    // 即使某次连接被开发服务器/代理断开，也自动重连，避免必须手动刷新页面。
    const subscribe = async () => {
      while (alive) {
        const controller = new AbortController();
        activeController = controller;
        try {
          const response = await fetch(`${API_BASE}/api/agents/${AGENT_ID}/threads/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({ threadId: id, resourceId: LOCAL_USER_RESOURCE }),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`线程订阅失败: ${response.status}`);
          if (!response.body) throw new Error('线程订阅未返回可读流');

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (alive) {
            const { value, done } = await reader.read();
            if (done) break;
            // 不依赖具体事件类型；收到任意非心跳数据都触发一次历史刷新。
            const chunk = decoder.decode(value, { stream: true });
            if (chunk.replace(/:\s*keep-alive\s*/g, '').trim()) refreshSoon();
          }
          reader.releaseLock();
        } catch (err) {
          if (alive) console.error('线程订阅失败', err);
        } finally {
          controller.abort();
          if (activeController === controller) activeController = undefined;
        }
        if (alive) await new Promise(resolve => setTimeout(resolve, 1_000));
      }
    };
    void subscribe();

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      if (refreshTimer) clearTimeout(refreshTimer);
      activeController?.abort();
    };
  }, [id]);

  if (boot === null) {
    return <div className="task-loading">加载任务中…</div>;
  }

  const initialAttachments =
    (location.state as { attachments?: PickedAttachment[] } | null)?.attachments ?? [];
  // 线程所属项目:仅从 HomePage 新建任务时的 location.state 获取
  const project = (location.state as { project?: Project } | null)?.project;
  // M10:首页输入框手动指定的技能(随首条消息进 requestContext)
  const initialSkill = (location.state as { skill?: string } | null)?.skill;

  return (
    <TaskChat
      // 定时执行会异步写入消息；数量变化时重建 runtime，显示最新 assistant 回复。
      // 后台执行完成后会新增 assistant 消息，数量变化时重建 runtime 以载入最新历史。
      // 不把内容长度放进 key，避免用户正在编辑输入框时被流式更新重置草稿。
      key={`${id}:${boot.messages.length}:${approvalReloadCount}`}
      taskId={id}
      history={boot.messages}
      pendingFirstMessage={initialMessage}
      initialAttachments={initialAttachments}
      project={project}
      initialSkill={initialSkill}
      pendingRegenRef={pendingRegenRef}
      onDecisionAccepted={reloadHistory}
      projects={projects}
      rawMessages={rawMessages}
      workspaceSince={workspaceSinceRef.current}
    />
  );
}

// 内层组件:runtime 必须在历史就绪后挂载(useChat 的 messages 选项只在创建时生效)
function TaskChat({
  taskId,
  history,
  pendingFirstMessage,
  initialAttachments,
  project,
  initialSkill,
  pendingRegenRef,
  onDecisionAccepted,
  projects,
  rawMessages,
  workspaceSince,
}: {
  taskId: string;
  history: UIMessage[];
  pendingFirstMessage?: string;
  initialAttachments?: PickedAttachment[];
  project?: Project;
  initialSkill?: string;
  // 外层的历史轮询计数器:>0 表示有重新生成进行中,暂停轮询避免中途 remount 掐断流
  pendingRegenRef: RefObject<number>;
  onDecisionAccepted?: () => void;
  projects: Project[];
  rawMessages: RawMastraMessage[];
  workspaceSince: number;
}) {
  // M2:任务内附件 —— 发送时拼进消息本体(实时即显卡片),发送后清空
  // initialAttachments:首页创建任务时带过来的附件(随首条消息注入)
  const [attachments, setAttachments] = useState<PickedAttachment[]>(initialAttachments ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 右侧预览面板开关状态写入 localStorage,跨任务和刷新保持用户偏好。
  const [previewOpen, setPreviewOpen] = useState(() => localStorage.getItem('h0-preview-open-v2') === 'true');
  // 预览标签状态提升到 TaskChat:产物协议与摘要入口共用同一组标签。
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [activePreviewTabId, setActivePreviewTabId] = useState('');
  const activePreviewTabIdRef = useRef(activePreviewTabId);
  activePreviewTabIdRef.current = activePreviewTabId;
  const [floatMode, setFloatMode] = useState(false);
  const [floatMinimized, setFloatMinimized] = useState(false);
  const [floatPosition, setFloatPosition] = useState<{ x: number; y: number } | null>(null);
  // M7:对话栏模型切换(localStorage 记忆,transport 每次请求携带)
  const [model, setModel] = useState(loadSelectedModel());
  const modelRef = useRef(model);
  modelRef.current = model;
  // M10:手动指定的技能(输入框选择,随请求进 requestContext.skill;发送后由 ChatThread 清空)。
  // 仅在空历史(任务刚创建,首条消息尚未发出)时播种:外层轮询会在首条消息落库后
  // 重挂本组件,location.state 仍在,若无条件播种会把已清除的标签又显示出来。
  const [skill, setSkill] = useState<string | null>(history.length === 0 ? (initialSkill ?? null) : null);
  const skillRef = useRef(skill);
  skillRef.current = skill;
  const previewTabsRef = useRef<PreviewTab[]>([]);
  previewTabsRef.current = previewTabs;
  const floatDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const previewSyncRef = useRef<BroadcastChannel | null>(null);
  const remoteZoomRef = useRef(false);

  // 任务监控入口与产物协议共用同一组预览标签;已有监控签时只激活。
  const openMonitorTab = useCallback(() => {
    const existing = previewTabsRef.current.find(tab => tab.kind === 'summary');
    if (existing) {
      setActivePreviewTabId(existing.id);
      setPreviewOpen(true);
      localStorage.setItem('h0-preview-open-v2', 'true');
      rememberRecentTab(existing);
      return;
    }
    const tab: PreviewTab = {
      id: `summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'summary',
      title: '任务监控',
      payload: { kind: 'summary' },
    };
    previewTabsRef.current = [...previewTabsRef.current, tab];
    setPreviewTabs(previewTabsRef.current);
    setActivePreviewTabId(tab.id);
    setPreviewOpen(true);
    localStorage.setItem('h0-preview-open-v2', 'true');
    rememberRecentTab(tab);
  }, []);

  // 打开 workspace 产物标签;同 path 只激活,不重复创建。
  // options.reveal 控制是否展开面板并持久化:历史恢复时传 false,避免自动展开。
  const openArtifactTab = useCallback((name: string, path: string, options?: { reveal?: boolean }) => {
    const reveal = options?.reveal !== false;
    const existing = previewTabsRef.current.find(
      tab =>
        tab.kind === 'file' &&
        tab.payload.kind === 'file' &&
        tab.payload.source === 'workspace' &&
        tab.payload.path === path,
    );
    if (existing) {
      if (reveal) {
        setActivePreviewTabId(existing.id);
        setPreviewOpen(true);
        localStorage.setItem('h0-preview-open-v2', 'true');
      } else if (!activePreviewTabIdRef.current) {
        // 历史恢复不抢占用户当前标签,但首次没有任何标签时设为激活。
        setActivePreviewTabId(existing.id);
      }
      rememberRecentTab(existing);
      return;
    }
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const tab: PreviewTab = {
      id: `file-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'file',
      title: name,
      payload: { kind: 'file', source: 'workspace', path, name, ext },
    };
    previewTabsRef.current = [...previewTabsRef.current, tab];
    setPreviewTabs(previewTabsRef.current);
    if (reveal) {
      setActivePreviewTabId(tab.id);
      setPreviewOpen(true);
      localStorage.setItem('h0-preview-open-v2', 'true');
    } else if (!activePreviewTabIdRef.current) {
      // 历史恢复不抢占用户当前标签,但首次没有任何标签时设为激活。
      setActivePreviewTabId(tab.id);
    }
    rememberRecentTab(tab);
  }, []);

  const openArtifactTagTab = useCallback((artifactType: 'html' | 'slides' | 'doc', title: string, content: string) => {
    const existing = previewTabsRef.current.find(
      tab => tab.kind === 'artifact-tag' && tab.payload.kind === 'artifact-tag' && tab.payload.artifactType === artifactType && tab.payload.title === title,
    );
    if (existing) {
      setActivePreviewTabId(existing.id);
      setPreviewOpen(true);
      localStorage.setItem('h0-preview-open-v2', 'true');
      return;
    }
    const tab: PreviewTab = {
      id: `artifact-tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'artifact-tag',
      title,
      payload: { kind: 'artifact-tag', artifactType, title, content },
    };
    previewTabsRef.current = [...previewTabsRef.current, tab];
    setPreviewTabs(previewTabsRef.current);
    setActivePreviewTabId(tab.id);
    setPreviewOpen(true);
    localStorage.setItem('h0-preview-open-v2', 'true');
  }, []);
  // 打开内置浏览器标签；同 url 只激活，不重复创建。
  // options.reveal 控制是否展开面板并持久化：历史恢复时传 false，避免自动展开。
  const openBrowserTab = useCallback((url: string, title: string, options?: { reveal?: boolean }) => {
    const reveal = options?.reveal !== false;
    const existing = previewTabsRef.current.find(
      tab => tab.kind === 'browser' && tab.payload.kind === 'browser' && tab.payload.url === url,
    );
    if (existing) {
      if (reveal) {
        setActivePreviewTabId(existing.id);
        setPreviewOpen(true);
        localStorage.setItem('h0-preview-open-v2', 'true');
      } else if (!activePreviewTabIdRef.current) {
        // 历史恢复不抢占用户当前标签，但首次没有任何标签时设为激活。
        setActivePreviewTabId(existing.id);
      }
      rememberRecentTab(existing);
      return;
    }
    const tab: PreviewTab = {
      id: `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'browser',
      title,
      payload: { kind: 'browser', url, title },
    };
    previewTabsRef.current = [...previewTabsRef.current, tab];
    setPreviewTabs(previewTabsRef.current);
    if (reveal) {
      setActivePreviewTabId(tab.id);
      setPreviewOpen(true);
      localStorage.setItem('h0-preview-open-v2', 'true');
    } else if (!activePreviewTabIdRef.current) {
      // 历史恢复不抢占用户当前标签，但首次没有任何标签时设为激活。
      setActivePreviewTabId(tab.id);
    }
    rememberRecentTab(tab);
  }, []);

  const runtime = useChatRuntime({
    transport: createTaskTransport(taskId, () => ({
      model: modelRef.current,
      ...(skillRef.current ? { skill: skillRef.current } : {}),
      ...(project ? { projectDir: project.dir, projectName: project.name } : {}),
    })),
    id: taskId,
    messages: history,
  });

  // 浮窗标题栏空白区域按下后进入拖动;位置只保存在内存中。
  const handleFloatHeaderMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    floatDragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  };

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!floatDragRef.current) return;
      setFloatPosition({
        x: Math.max(0, event.clientX - floatDragRef.current.offsetX),
        y: Math.max(0, event.clientY - floatDragRef.current.offsetY),
      });
    };
    const handleMouseUp = () => {
      floatDragRef.current = null;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // 主窗响应独立弹窗的 payload 请求;收到弹窗 zoom 时标记为远端更新,避免再广播。
  useEffect(() => {
    const channel = new BroadcastChannel('h0-preview-sync');
    previewSyncRef.current = channel;
    channel.onmessage = event => {
      const message = event.data as PreviewSyncMessage;
      if (message.type === 'request-payload') {
        const tab = previewTabsRef.current.find(item => item.id === message.tabId);
        if (tab) channel.postMessage({ type: 'payload', tabId: tab.id, tab, threadId: taskId });
        return;
      }
      if (message.type === 'zoom' && Number.isFinite(message.zoom)) {
        remoteZoomRef.current = true;
        setPreviewTabs(current =>
          current.map(item => (item.id === message.tabId ? { ...item, zoom: message.zoom } : item)),
        );
        return;
      }
      if (message.type === 'window-closed') console.info(`预览弹窗已关闭: ${message.tabId}`);
    };
    return () => {
      channel.close();
      previewSyncRef.current = null;
    };
  }, [taskId]);

  const activePreviewTab = previewTabs.find(tab => tab.id === activePreviewTabId);
  const activePreviewZoom = activePreviewTab?.zoom ?? 100;
  // 本地 zoom 变化延迟广播;remoteZoomRef 保证来自弹窗的更新不会被回传。
  useEffect(() => {
    if (!activePreviewTabId || remoteZoomRef.current) {
      remoteZoomRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      previewSyncRef.current?.postMessage({
        type: 'zoom',
        tabId: activePreviewTabId,
        zoom: activePreviewZoom,
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [activePreviewTabId, activePreviewZoom]);

  const handleModelChange = (id: string) => {
    setModel(id);
    saveSelectedModel(id);
  };

  // 首条消息:仅当任务为空且创建时带了输入内容时自动发出(F2)
  // 附件全文随首条消息一起注入(实时即显卡片)
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    if (!pendingFirstMessage && (initialAttachments?.length ?? 0) === 0) return;
    if (history.length > 0) return;
    sentRef.current = true;
    const section =
      initialAttachments && initialAttachments.length > 0
        ? `\n\n${attachmentSection(initialAttachments)}`
        : '';
    runtime.thread.append((pendingFirstMessage ?? '') + section);
    setAttachments([]);
  }, [runtime, pendingFirstMessage, initialAttachments, history.length]);

  // H0:首次消息成功后绑定线程 ↔ 项目(幂等,remount 重复触发无副作用)
  const linkedRef = useRef(false);
  useEffect(() => {
    if (linkedRef.current || !project || history.length === 0) return;
    linkedRef.current = true;
    linkThread(taskId, project.id).catch(err => console.error('绑定项目失败', err));
  }, [project, history.length, taskId]);

  // 挂载时全量扫描历史回复,刷新页面后也能恢复产物标签(openArtifactTab 内部去重)。
  // 恢复时只建标签不展开面板,避免任何会话都自动展开。
  const historyArtifactsScannedRef = useRef(false);
  useEffect(() => {
    if (historyArtifactsScannedRef.current) return;
    historyArtifactsScannedRef.current = true;
    history
      .filter(message => message.role === 'assistant')
      .forEach(message => {
        const text = getUIMessageText(message);
        parseArtifacts(text).forEach(artifact => {
          openArtifactTab(artifact.name, artifact.path, { reveal: false });
        });
        parseWebPages(text).forEach(webPage => {
          openBrowserTab(webPage.url, webPage.title, { reveal: false });
        });
      });
  }, [history, openArtifactTab]);

  // 产物卡片通过全局事件请求打开预览标签。
  useEffect(() => {
    const handleOpenArtifact = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (detail?.kind === 'artifact-tag') {
        openArtifactTagTab(detail.type, detail.title, detail.content);
        return;
      }
      if (detail?.name && detail?.path) openArtifactTab(detail.name, detail.path);
    };
    window.addEventListener('h0-open-artifact', handleOpenArtifact);
    return () => window.removeEventListener('h0-open-artifact', handleOpenArtifact);
  }, [openArtifactTab]);

  // 网页卡片通过全局事件请求打开内置浏览器标签。
  useEffect(() => {
    const handleOpenWebPage = (event: Event) => {
      const detail = (event as CustomEvent<WebPage>).detail;
      if (detail?.title && detail?.url) openBrowserTab(detail.url, detail.title);
    };
    window.addEventListener('h0-open-webpage', handleOpenWebPage);
    return () => window.removeEventListener('h0-open-webpage', handleOpenWebPage);
  }, [openBrowserTab]);

  // runtime 空闲时,解析最后一条 assistant 文本并自动打开产物/网页标签。
  // 用"消息 id 去重"而不是"运行→空闲的边沿检测":TaskPage 会因消息数变化重挂载,
  // 重挂载后 wasRunningRef 归零,那个边沿永远等不到,网页/产物就不会自动打开
  // (2026-09-18 用户反馈"检索到的网页在侧边栏不自动打开")。
  const autoOpenedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    return runtime.thread.subscribe(() => {
      const state = runtime.thread.getState();
      // 流式进行中不处理;结束后该消息只自动打开一次
      if (state.isRunning) return;
      const lastAssistant = [...state.messages].reverse().find(message => message.role === 'assistant');
      if (!lastAssistant || autoOpenedIdsRef.current.has(lastAssistant.id)) return;
      const text = lastAssistant.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n');
      const artifacts = parseArtifacts(text);
      const webPages = parseWebPages(text);
      if (artifacts.length === 0 && webPages.length === 0) return;
      autoOpenedIdsRef.current.add(lastAssistant.id);
      artifacts.forEach(artifact => {
        openArtifactTab(artifact.name, artifact.path);
      });
      webPages.forEach(webPage => {
        openBrowserTab(webPage.url, webPage.title);
      });
    });
  }, [runtime, openArtifactTab]);

  // 重新生成:前端交给 assistant-ui 原生 reload(ActionBarPrimitive.Reload)。
  // 它走 AI SDK regenerate,请求带 trigger=regenerate-message,
  // Mastra chatRoute 据此丢掉末尾旧回复重新生成,并以旧消息 id 回流 → 界面是替换而非追加。
  //
  // 这里只负责善后:chatRoute 的 lastMessageId 只作用于 AI SDK 流转换层,
  // 服务端 memory 里旧回复通常仍然存在(新回复另起一条),刷新页面就会看到两条。
  // 因此流式结束后按 id 清理旧回复;删除路由带"仅当存在更新的 assistant 消息时才删"的保护,
  // 万一某版本改为同 id 覆写,也不会误删新回复。
  const handleRegenerateStart = useCallback(
    (messageId: string) => {
      // 期间暂停历史轮询:新回复入库与旧回复删除之间消息数会先 +1 再 -1,
      // 轮询命中会改变 TaskPage 的 key 导致 TaskChat 重挂、掐断正在进行的流
      pendingRegenRef.current += 1;

      void (async () => {
        try {
          // 等 reload 真正把线程带入运行态(onClick 先于 reload 执行,此刻还没开始)
          const started = await waitFor(() => runtime.thread.getState().isRunning, 5_000);
          // 再等流式结束;工具调用链可能较久,给足超时
          if (started) await waitFor(() => !runtime.thread.getState().isRunning, 300_000);

          await fetch(`${API_BASE}/messages/delete-assistant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              threadId: taskId,
              resourceId: LOCAL_USER_RESOURCE,
              messageId,
            }),
          });
        } catch (err) {
          console.error('重新生成后清理旧回复失败', err);
        } finally {
          pendingRegenRef.current -= 1;
        }
      })();
    },
    [runtime, taskId, pendingRegenRef],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="task-workspace">
        <div className="task-thread-wrap">
          {!floatMode ? (
            <ChatThread
              threadId={taskId}
              runtime={runtime}
              attachments={attachments}
              model={model}
              onModelChange={handleModelChange}
              onRegenerateStart={handleRegenerateStart}
              onDecisionAccepted={onDecisionAccepted}
              onOpenPicker={() => setPickerOpen(true)}
              onRemoveAttachment={id => setAttachments(prev => prev.filter(a => a.id !== id))}
              onAttachmentsConsumed={() => setAttachments([])}
              skill={skill}
              onSkillChange={setSkill}
              onSuspendPending={(toolName, runId) => {
                if (toolName === 'ask_user') {
                  // M15 bug 修复(2026-09-20 用户实测发现):ask_user 挂起时问题表单
                  // 渲染在右侧 PreviewPanel 的「问题」标签里,而 PreviewPanel 只在
                  // previewOpen 时才挂载——用户没手动展开预览栏,模型在等回答但
                  // 用户什么都看不到。检测到挂起就强制展开预览栏。
                  setPreviewOpen(true);
                  localStorage.setItem('h0-preview-open-v2', 'true');
                  return;
                }
                if (toolName === 'enter_design_plan') {
                  // M16:设计计划确认同样需要展开预览栏,「设计计划」标签会在 T7(批2)接入后自动弹出。
                  // 本批先展开预览栏,标签本身的自动打开逻辑在 PreviewPanel.tsx 里(T6 任务)。
                  setPreviewOpen(true);
                  localStorage.setItem('h0-preview-open-v2', 'true');
                }
              }}
            />
          ) : (
            <HomePage projects={projects} />
          )}
          <div className="chat-corner-actions">
            <button
              className="chat-corner-action"
              title="在浮窗中打开对话"
              onClick={() => {
                setFloatMode(true);
                setFloatMinimized(false);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <rect x="4" y="5" width="16" height="14" rx="3" />
                <path d="M4 9h16" />
              </svg>
            </button>
            <button className="chat-corner-action" title="任务监控" onClick={openMonitorTab}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M6 6h12M6 10h12M6 14h7M6 18h10" />
              </svg>
            </button>
            <button
              className="chat-corner-action"
              title="预览面板"
              onClick={() => {
                const next = !previewOpen;
                setPreviewOpen(next);
                localStorage.setItem('h0-preview-open-v2', next ? 'true' : 'false');
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <rect x="4" y="5" width="16" height="14" rx="3" />
                <path d="M14 5v14" />
              </svg>
            </button>
          </div>
        </div>
        {previewOpen && (
          <PreviewPanel
            threadId={taskId}
            runtime={runtime}
            rawMessages={rawMessages}
            workspaceSince={workspaceSince}
            tabs={previewTabs}
            activeTabId={activePreviewTabId}
            onTabsChange={setPreviewTabs}
            onActivate={setActivePreviewTabId}
            onClose={() => {
              setPreviewOpen(false);
              localStorage.setItem('h0-preview-open-v2', 'false');
            }}
          />
        )}
      </div>
      {floatMode && (
        <div
          className={`chat-float-window${floatMinimized ? ' is-minimized' : ''}`}
          style={floatPosition ? { left: floatPosition.x, top: floatPosition.y } : undefined}
        >
          <div className="chat-float-header" onMouseDown={handleFloatHeaderMouseDown}>
            <span>对话浮窗</span>
            <div className="chat-float-actions">
              <button title={floatMinimized ? '恢复浮窗' : '最小化浮窗'} onClick={() => setFloatMinimized(value => !value)}>
                {floatMinimized ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M8 12h8M7 7l-2 5 2 5M17 7l2 5-2 5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M6 12h12" />
                  </svg>
                )}
              </button>
              <button title="关闭浮窗并恢复内嵌对话" onClick={() => setFloatMode(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>
          <div className="chat-float-body">
            <ChatThread
              compact
              threadId={taskId}
              runtime={runtime}
              attachments={attachments}
              model={model}
              onModelChange={handleModelChange}
              onRegenerateStart={handleRegenerateStart}
              onOpenPicker={() => setPickerOpen(true)}
              onRemoveAttachment={id => setAttachments(prev => prev.filter(a => a.id !== id))}
              onAttachmentsConsumed={() => setAttachments([])}
              skill={skill}
              onSkillChange={setSkill}
              onSuspendPending={(toolName, runId) => {
                if (toolName === 'ask_user') {
                  setPreviewOpen(true);
                  localStorage.setItem('h0-preview-open-v2', 'true');
                  return;
                }
                if (toolName === 'enter_design_plan') {
                  // M16:设计计划确认同样需要展开预览栏,本批先展开,标签自动打开在 PreviewPanel 中实现。
                  setPreviewOpen(true);
                  localStorage.setItem('h0-preview-open-v2', 'true');
                }
              }}
            />
          </div>
        </div>
      )}
      {pickerOpen && (
        <AttachmentPicker
          onClose={() => setPickerOpen(false)}
          onPick={a => {
            if (attachments.some(x => x.id === a.id)) return true;
            if (attachments.length >= 5) return false;
            setAttachments(prev => [...prev, a]);
            return true;
          }}
        />
      )}
    </AssistantRuntimeProvider>
  );
}
