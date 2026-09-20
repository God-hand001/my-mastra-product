import { useEffect, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { renameThread, type TaskThread } from '../lib/agentClient';
import { isDesktop } from '../lib/desktop';
import { linkThread, openPath, removeProject, type Project, type ThreadLink } from '../lib/projectsClient';
import {
  exportThreadToMarkdown,
  getArchivedTasks,
  getPinnedTasks,
  setArchivedTasks,
  togglePinnedTask,
} from '../lib/threadActions';
import { ProjectModal } from './ProjectModal';
import { useTaskStore } from '../lib/taskStore';

// 侧边栏分组折叠状态；true 表示收起
type SidebarCollapseState = {
  pinned: boolean;
  projects: boolean;
  recent: boolean;
};

const SIDEBAR_COLLAPSE_KEY = 'h0-sidebar-collapse';

// 从本地存储读取折叠状态，历史数据缺失或异常时按展开处理
function readSidebarCollapse(): SidebarCollapseState {
  const fallback: SidebarCollapseState = { pinned: false, projects: false, recent: false };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) || '{}');
    return {
      pinned: typeof parsed.pinned === 'boolean' ? parsed.pinned : fallback.pinned,
      projects: typeof parsed.projects === 'boolean' ? parsed.projects : fallback.projects,
      recent: typeof parsed.recent === 'boolean' ? parsed.recent : fallback.recent,
    };
  } catch {
    return fallback;
  }
}

// 侧边栏统一使用单色线性图标，颜色由 CSS 的 currentColor 继承。
export function SidebarIcon({ name }: { name: 'task' | 'apps' | 'schedule' | 'web' | 'chat' | 'drive' | 'folder' }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  const paths = {
    task: <><path d="M5 4.5h14v15H5z" /><path d="m8 9 1.5 1.5L12 8" /><path d="M8 14h8" /></>,
    apps: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    schedule: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    web: <><circle cx="12" cy="12" r="8.5" /><path d="M3.8 12h16.4M12 3.5c2.2 2.4 3.3 5.2 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.2-3.3-8.5S9.8 5.9 12 3.5Z" /></>,
    chat: <><path d="M4 5.5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3.2a2 2 0 0 1-1-1.8v-7a2 2 0 0 1 2-2Z" /><path d="M18 10h1.5a2 2 0 0 1 2 2v5l-2.5-1.5" /></>,
    drive: <><path d="M4.5 7.5h5l1.7 2h8.3v9h-15z" /><path d="M4.5 7.5v-1h5l1.7 2" /></>,
    folder: <><path d="M3.5 6.5h6l1.7 2h9.3v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

function getPinned(): string[] {
  try {
    return JSON.parse(localStorage.getItem('h0-pinned-projects') ?? '[]') as string[];
  } catch {
    return [];
  }
}

function togglePinned(id: string): string[] {
  const pinned = getPinned();
  const next = pinned.includes(id) ? pinned.filter(x => x !== id) : [id, ...pinned];
  localStorage.setItem('h0-pinned-projects', JSON.stringify(next));
  return next;
}

// 侧边栏展示前过滤归档任务,并让置顶任务保持在各自分组前部
// excludePinned=true 用于"最近"分组,避免与"置顶"分组重复
function filterAndSortTasks(tasks: TaskThread[], pinned: string[], excludePinned = false): TaskThread[] {
  const archived = getArchivedTasks();
  return tasks
    .filter(task => !archived.includes(task.id) && !(excludePinned && pinned.includes(task.id)))
    .slice()
    .sort((a, b) => {
      const pinnedA = pinned.includes(a.id) ? 0 : 1;
      const pinnedB = pinned.includes(b.id) ? 0 : 1;
      if (pinnedA !== pinnedB) return pinnedA - pinnedB;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function TaskListItem({
  task,
  indent,
  projects,
  batchMode,
  selectedTasks,
  onEnterBatchMode,
  onToggleBatchSelection,
}: {
  task: TaskThread;
  indent?: boolean;
  projects: Project[];
  batchMode?: boolean;
  selectedTasks?: Set<string>;
  onEnterBatchMode?: () => void;
  onToggleBatchSelection?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const { refresh, removeTask } = useTaskStore();
  const { pathname } = useLocation();
  const isCurrent = matchPath(`/task/${task.id}`, pathname) != null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(task.title);
  const [showProjectList, setShowProjectList] = useState(false);
  const [copied, setCopied] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  const closeMenu = () => {
    setMenuOpen(false);
    setShowProjectList(false);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameValue(task.title);
  };

  const submitRename = () => {
    const title = renameValue.trim();
    if (!title || title === task.title) {
      cancelRename();
      return;
    }
    setRenaming(false);
    void renameThread(task.id, title)
      .then(() => refresh())
      .catch(error => console.error('重命名任务失败', error))
      .finally(() => setRenameValue(task.title));
  };

  return (
    <div
      className={`task-list-item${isCurrent ? ' is-current' : ''}${indent ? ' is-indent' : ''}${
        batchMode && selectedTasks?.has(task.id) ? ' is-selected' : ''
      }`}
      onClick={() => (batchMode ? onToggleBatchSelection?.(task.id) : navigate(`/task/${task.id}`))}
    >
      <div className="task-list-item-head">
        {renaming ? (
          <input
            ref={renameInputRef}
            className="task-item-rename-input"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') cancelRename();
            }}
            onBlur={cancelRename}
          />
        ) : (
          <div className="task-list-item-title">{task.title || '未命名任务'}</div>
        )}
        {batchMode ? (
          <input
            type="checkbox"
            className="task-item-check"
            checked={selectedTasks?.has(task.id) ?? false}
            onChange={() => onToggleBatchSelection?.(task.id)}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <button
            className="task-item-more"
            title="更多操作"
            onClick={e => {
              e.stopPropagation();
              setMenuOpen(open => !open);
            }}
          >
            ⋯
          </button>
        )}
      </div>
      {!indent && (
        <div className="task-list-item-row">
          <span className="task-list-item-time">{relativeTime(task.updatedAt)}</span>
        </div>
      )}
      {menuOpen && (
        <>
          <div className="model-menu-backdrop" onClick={closeMenu} />
          <div className="project-menu task-menu">
            <button
              onClick={() => {
                setRenameValue(task.title);
                setRenaming(true);
                closeMenu();
              }}
            >
              <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
              重命名
            </button>
            <button
              onClick={() => {
                togglePinnedTask(task.id);
                window.dispatchEvent(new CustomEvent('h0-task-list-changed'));
                closeMenu();
              }}
            >
              📌 {getPinnedTasks().includes(task.id) ? '取消置顶' : '置顶任务'}
            </button>
            {isDesktop() && (
              <>
                <button disabled={projects.length === 0} onClick={() => setShowProjectList(open => !open)}>
                  📁 移到项目
                </button>
                {showProjectList && (
                  <div className="task-menu-projects">
                    {projects.map(project => (
                      <button
                        key={project.id}
                        onClick={() => {
                          void linkThread(task.id, project.id)
                            .then(() => refresh())
                            .catch(error => console.error('移动任务到项目失败', error));
                          closeMenu();
                        }}
                      >
                        {project.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <button
              onClick={() => {
                void exportThreadToMarkdown(task).catch(error => console.error(error));
                closeMenu();
              }}
            >
              📤 导出对话记录
            </button>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(task.id);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1000);
              }}
            >
              📋 {copied ? '已复制' : '复制 ID'}
            </button>
            <button disabled={!onEnterBatchMode} onClick={onEnterBatchMode}>
              🧹 批量操作
            </button>
            <button
              className="project-menu-danger"
              onClick={() => {
                setArchivedTasks([...getArchivedTasks(), task.id]);
                void refresh();
                closeMenu();
              }}
            >
              🗃 归档任务
            </button>
            <button
              className="project-menu-danger"
              onClick={() => {
                if (!window.confirm(`删除任务「${task.title || '未命名任务'}」?`)) return;
                void removeTask(task.id).then(() => {
                  if (isCurrent) navigate('/');
                });
                closeMenu();
              }}
            >
              🗑 删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// 项目节点(千问形态:📁 + 名称,嵌套任务,hover 出 ⋯ + ✏️)
function ProjectItem({
  project,
  tasks,
  projects,
  links,
  selectedId,
  onSelect,
  onEdit,
}: {
  project: Project;
  tasks: TaskThread[];
  projects: Project[];
  links: ThreadLink[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (p: Project) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const taskPinned = getPinnedTasks();
  const linkedTasks = filterAndSortTasks(
    links
      .filter(l => l.projectId === project.id)
      .map(l => tasks.find(t => t.id === l.threadId))
      .filter((t): t is TaskThread => !!t),
    taskPinned,
  );
  const isPinned = getPinned().includes(project.id);

  return (
    <div className="project-item-wrap">
      <div
        className={`project-item${selectedId === project.id ? ' is-current' : ''}`}
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? '展开项目任务' : '折叠项目任务'}
      >
        <span className="project-item-name"><SidebarIcon name="folder" /> {project.name}</span>
        <span className="project-item-actions" onClick={e => e.stopPropagation()}>
          <button
            className="project-item-btn"
            title="更多操作"
            onClick={() => setMenuOpen(o => !o)}
          >
            ⋯
          </button>
          <button
            className="project-item-btn"
            title="在此项目中新建任务"
            onClick={() => {
              onSelect(project.id);
              navigate('/');
            }}
          >
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
        </span>
        {menuOpen && (
          <>
            <div className="model-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="project-menu">
              <button
                onClick={() => {
                  togglePinned(project.id);
                  setMenuOpen(false);
                  window.dispatchEvent(new CustomEvent('h0-projects-changed'));
                }}
              >
                📌 {isPinned ? '取消置顶' : '置顶项目'}
              </button>
              <button
                disabled={!project.dir}
                onClick={() => {
                  if (project.dir) void openPath(project.dir);
                  setMenuOpen(false);
                }}
              >
                📂 打开文件夹
              </button>
              <button
                onClick={() => {
                  onEdit(project);
                  setMenuOpen(false);
                }}
              >
                ✏️ 编辑项目
              </button>
              <button
                className="project-menu-danger"
                onClick={() => {
                  if (window.confirm(`移除项目「${project.name}」?线程与文件不受影响`)) {
                    void removeProject(project.id).then(() =>
                      window.dispatchEvent(new CustomEvent('h0-projects-changed')),
                    );
                    if (selectedId === project.id) onSelect('');
                    setMenuOpen(false);
                  }
                }}
              >
                🗑 移除项目
              </button>
            </div>
          </>
        )}
      </div>
      {!collapsed && (
        <div className="project-tasks">
          {linkedTasks.map(t => (
                <TaskListItem key={t.id} task={t} indent projects={projects} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  const { refresh, removeTask, tasks, loading, links, selectedProject, setSelectedProject } = useTaskStore();
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<'tasks' | 'channels'>('tasks');
  const [collapse, setCollapse] = useState<SidebarCollapseState>(readSidebarCollapse);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelectedTasks, setBatchSelectedTasks] = useState<Set<string>>(new Set());
  const [batchProjectPickerOpen, setBatchProjectPickerOpen] = useState(false);
  // 两套置顶列表互不相干,别混用:
  //   pinnedProjects → localStorage 'h0-pinned-projects'(项目 id)
  //   pinnedTaskIds  → localStorage 'h0-pinned-tasks'(线程 id)
  // 之前"置顶"分组恒为空,就是因为拿项目置顶列表去筛任务 —— 两个 id 空间永不相交。
  const pinnedProjects = getPinned();
  const pinnedTaskIds = getPinnedTasks();
  const [, setTaskOrderVersion] = useState(0);

  useEffect(() => {
    const handleTaskOrderChanged = () => setTaskOrderVersion(version => version + 1);
    window.addEventListener('h0-task-list-changed', handleTaskOrderChanged);
    return () => window.removeEventListener('h0-task-list-changed', handleTaskOrderChanged);
  }, []);

  // 切换分组折叠并同步写回本地存储
  const toggleCollapse = (key: keyof SidebarCollapseState) => {
    setCollapse(prev => {
      const next = { ...prev, [key]: !prev[key] };
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // 项目排序用项目置顶列表
  const sortedProjects = [...projects].sort((a, b) => {
    const pa = pinnedProjects.includes(a.id) ? 0 : 1;
    const pb = pinnedProjects.includes(b.id) ? 0 : 1;
    return pa - pb || b.createdAt.localeCompare(a.createdAt);
  });

  // 任务列表用任务置顶列表:"最近"排除已置顶(excludePinned),"置顶"分组只取已置顶
  // 项目内创建/关联的任务只归项目分组,不进"最近"(2026-09-17 用户定向)
  const projectLinkedThreadIds = new Set(links.map(l => l.threadId));
  const visibleTasks = filterAndSortTasks(
    tasks.filter(t => !projectLinkedThreadIds.has(t.id)),
    pinnedTaskIds,
    true,
  );
  const pinnedTasks = filterAndSortTasks(
    tasks.filter(t => pinnedTaskIds.includes(t.id)),
    pinnedTaskIds,
  );

  const exitBatchMode = () => {
    setBatchMode(false);
    setBatchSelectedTasks(new Set());
    setBatchProjectPickerOpen(false);
  };

  const toggleBatchSelection = (id: string) => {
    setBatchSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleBatchSelectAll = () => {
    const isAllSelected = visibleTasks.length > 0 && visibleTasks.every(task => batchSelectedTasks.has(task.id));
    setBatchSelectedTasks(isAllSelected ? new Set() : new Set(visibleTasks.map(task => task.id)));
  };

  const archiveBatch = async () => {
    if (batchSelectedTasks.size === 0) return;
    setArchivedTasks([...new Set([...getArchivedTasks(), ...batchSelectedTasks])]);
    await refresh();
    exitBatchMode();
  };

  const removeBatch = async () => {
    if (batchSelectedTasks.size === 0) return;
    if (!window.confirm(`删除选中的 ${batchSelectedTasks.size} 个任务?`)) return;
    for (const id of batchSelectedTasks) {
      await removeTask(id);
    }
    await refresh();
    exitBatchMode();
  };

  const moveBatchToProject = async (projectId: string) => {
    for (const id of batchSelectedTasks) {
      await linkThread(id, projectId).catch(error => console.error('批量移动任务到项目失败', error));
    }
    await refresh();
    exitBatchMode();
  };

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">嘉立创Work</div>

      <button className="sidebar-nav-item" onClick={() => navigate('/')}>
        <span className="sidebar-nav-icon"><SidebarIcon name="task" /></span> 新任务
      </button>

      <button className="sidebar-nav-item" onClick={() => navigate('/extensions')}>
        <span className="sidebar-nav-icon"><SidebarIcon name="apps" /></span> 扩展
      </button>

      <button className="sidebar-nav-item" onClick={() => navigate('/schedules')}>
        <span className="sidebar-nav-icon"><SidebarIcon name="schedule" /></span> 定时任务
      </button>

      <button className="sidebar-nav-item" onClick={() => navigate('/models')}>
        <span className="sidebar-nav-icon"><SidebarIcon name="web" /></span> 我的模型
      </button>

      <button className="sidebar-nav-item sidebar-nav-disabled" title="后续上线">
        <span className="sidebar-nav-icon"><SidebarIcon name="chat" /></span> IM 频道
      </button>

      <button className="sidebar-nav-item" onClick={() => navigate('/drive')}>
        <span className="sidebar-nav-icon"><SidebarIcon name="drive" /></span> 个人网盘
      </button>

      {/* 任务/频道 Tab(千问形态) */}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab${activeTab === 'tasks' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          任务
        </button>
        <button
          className={`sidebar-tab${activeTab === 'channels' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('channels')}
        >
          频道
        </button>
        <span className="sidebar-tab-filter" title="筛选">☰</span>
      </div>

      {activeTab === 'tasks' && (
        <div className="sidebar-scroll">
          {isDesktop() && (
            <>
              <div
                className="sidebar-section sidebar-section-clickable"
                onClick={() => toggleCollapse('pinned')}
                title={collapse.pinned ? '展开置顶任务' : '折叠置顶任务'}
              >
                <span className="sidebar-section-title">
                  <span>置顶</span>
                  <span className={`sidebar-section-chev${collapse.pinned ? ' is-collapsed' : ' is-expanded'}`}>›</span>
                </span>
              </div>
              {!collapse.pinned && (
                <div className="task-list">
                  {pinnedTasks.length === 0 ? (
                    <div className="task-list-empty">暂无置顶任务</div>
                  ) : (
                    pinnedTasks.map(task => (
                      <TaskListItem
                        key={task.id}
                        task={task}
                        projects={projects}
                        batchMode={batchMode}
                        selectedTasks={batchSelectedTasks}
                        onEnterBatchMode={() => setBatchMode(true)}
                        onToggleBatchSelection={toggleBatchSelection}
                      />
                    ))
                  )}
                </div>
              )}
              <div className="sidebar-section-row">
                <div
                  className="sidebar-section-clickable"
                  onClick={() => toggleCollapse('projects')}
                  title={collapse.projects ? '展开项目' : '折叠项目'}
                >
                  <span className="sidebar-section-title">
                    <span>项目</span>
                    <span className={`sidebar-section-chev${collapse.projects ? ' is-collapsed' : ' is-expanded'}`}>›</span>
                  </span>
                </div>
                <button
                  className="sidebar-section-add"
                  title="新建项目"
                  onClick={e => {
                    e.stopPropagation();
                    setEditingProject(null);
                    setProjectModalOpen(true);
                  }}
                >
                  +
                </button>
              </div>
              {/* 项目分组折叠时不渲染列表 */}
              {!collapse.projects && (
                <div className="project-list">
                  {projects.length === 0 ? (
                    <div className="task-list-empty">暂无项目</div>
                  ) : (
                    sortedProjects.map(p => (
                      <ProjectItem
                        key={p.id}
                        project={p}
                        tasks={tasks}
                        projects={projects}
                        links={links}
                        selectedId={selectedProject}
                        onSelect={id => setSelectedProject(id || null)}
                        onEdit={proj => {
                          setEditingProject(proj);
                          setProjectModalOpen(true);
                        }}
                      />
                    ))
                  )}
                </div>
              )}
              <div
                className="sidebar-section sidebar-section-clickable"
                onClick={() => toggleCollapse('recent')}
                title={collapse.recent ? '展开最近任务' : '折叠最近任务'}
              >
                <span className="sidebar-section-title">
                  <span>最近</span>
                  <span className={`sidebar-section-chev${collapse.recent ? ' is-collapsed' : ' is-expanded'}`}>›</span>
                </span>
              </div>
            </>
          )}
          {!isDesktop() && (
            <div
              className="sidebar-section sidebar-section-clickable"
              onClick={() => toggleCollapse('recent')}
              title={collapse.recent ? '展开最近任务' : '折叠最近任务'}
            >
              <span className="sidebar-section-title">
                <span>最近</span>
                <span className={`sidebar-section-chev${collapse.recent ? ' is-collapsed' : ' is-expanded'}`}>›</span>
              </span>
            </div>
          )}
          {!collapse.recent && (
            <div className="task-list">
              {batchMode && (
                <div className="batch-bar">
                  <span>已选 {batchSelectedTasks.size} 项</span>
                  <button onClick={toggleBatchSelectAll}>
                    {visibleTasks.length > 0 && visibleTasks.every(task => batchSelectedTasks.has(task.id))
                      ? '取消全选'
                      : '全选'}
                  </button>
                  <button disabled={batchSelectedTasks.size === 0} onClick={archiveBatch}>
                    归档
                  </button>
                  {isDesktop() && projects.length > 0 && (
                    <button
                      disabled={batchSelectedTasks.size === 0}
                      onClick={() => setBatchProjectPickerOpen(open => !open)}
                    >
                      移到项目
                    </button>
                  )}
                  <button
                    className="batch-bar-danger"
                    disabled={batchSelectedTasks.size === 0}
                    onClick={removeBatch}
                  >
                    删除
                  </button>
                  <button onClick={exitBatchMode}>退出</button>
                  {batchProjectPickerOpen && (
                    <div className="task-menu-projects batch-project-list">
                      {projects.map(project => (
                        <button key={project.id} onClick={() => moveBatchToProject(project.id)}>
                          {project.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {loading ? (
                <div className="task-list-empty">加载中…</div>
              ) : tasks.length === 0 ? (
                <div className="task-list-empty">还未创建过任务</div>
              ) : (
                visibleTasks.map(task => (
                  <TaskListItem
                    key={task.id}
                    task={task}
                    projects={projects}
                    batchMode={batchMode}
                    selectedTasks={batchSelectedTasks}
                    onEnterBatchMode={() => setBatchMode(true)}
                    onToggleBatchSelection={toggleBatchSelection}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'channels' && (
        <div className="task-list">
          <div className="task-list-empty">暂无频道</div>
        </div>
      )}

      {projectModalOpen && (
        <ProjectModal
          initial={editingProject}
          onClose={() => setProjectModalOpen(false)}
          onSaved={() => {
            setProjectModalOpen(false);
            window.dispatchEvent(new CustomEvent('h0-projects-changed'));
          }}
        />
      )}

      <div className="sidebar-footer">
        <div className="sidebar-avatar">g</div>
        <div className="sidebar-footer-info">
          <div className="sidebar-username">god</div>
          <div className="sidebar-plan">个人免费版</div>
        </div>
        <div className="sidebar-footer-actions">
          <button className="sidebar-footer-btn" title="设置">⚙</button>
        </div>
      </div>
    </aside>
  );
}
