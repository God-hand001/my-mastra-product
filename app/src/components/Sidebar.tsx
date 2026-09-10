import { useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { isDesktop } from '../lib/desktop';
import { openPath, removeProject, type Project, type ThreadLink } from '../lib/projectsClient';
import { ProjectModal } from './ProjectModal';
import { useTaskStore } from '../lib/taskStore';
import type { TaskThread } from '../lib/agentClient';

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

// 置顶项目(H0:localStorage 记录,排序置顶)
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

function TaskListItem({ task, indent }: { task: TaskThread; indent?: boolean }) {
  const navigate = useNavigate();
  const { removeTask } = useTaskStore();
  const { pathname } = useLocation();
  const isCurrent = matchPath(`/task/${task.id}`, pathname) != null;

  return (
    <div
      className={`task-list-item${isCurrent ? ' is-current' : ''}${indent ? ' is-indent' : ''}`}
      onClick={() => navigate(`/task/${task.id}`)}
    >
      <div className="task-list-item-title">{task.title || '未命名任务'}</div>
      <div className="task-list-item-row">
        <span className="task-list-item-time">{relativeTime(task.updatedAt)}</span>
        <button
          className="task-list-item-delete"
          title="删除任务"
          onClick={e => {
            e.stopPropagation();
            void removeTask(task.id).then(() => {
              if (isCurrent) navigate('/');
            });
          }}
        >
          删除
        </button>
      </div>
    </div>
  );
}

// 项目节点(H0,对齐千问:项目下嵌套任务;hover 出 ⋯ 菜单与 ✏️ 新建任务)
function ProjectItem({
  project,
  tasks,
  links,
  selectedId,
  onSelect,
  onEdit,
}: {
  project: Project;
  tasks: TaskThread[];
  links: ThreadLink[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (p: Project) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const linkedTasks = links
    .filter(l => l.projectId === project.id)
    .map(l => tasks.find(t => t.id === l.threadId))
    .filter((t): t is TaskThread => !!t)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const isPinned = getPinned().includes(project.id);

  return (
    <div className="project-item-wrap">
      <div
        className={`project-item${selectedId === project.id ? ' is-current' : ''}`}
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? '展开项目任务' : '折叠项目任务'}
      >
        <span className={`project-item-chevron${collapsed ? ' is-collapsed' : ''}`}>▾</span>
        <span className="project-item-name">📁 {project.name}</span>
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
            ✏️
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
            <TaskListItem key={t.id} task={t} indent />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  const { tasks, loading, links, selectedProject, setSelectedProject } = useTaskStore();
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const pinned = getPinned();

  const sortedProjects = [...projects].sort((a, b) => {
    const pa = pinned.includes(a.id) ? 0 : 1;
    const pb = pinned.includes(b.id) ? 0 : 1;
    return pa - pb || b.createdAt.localeCompare(a.createdAt);
  });

  // 已归属项目的会话嵌在项目下,最近任务只显示未归属的
  const linkedThreadIds = new Set(links.map(l => l.threadId));
  const recentTasks = tasks.filter(t => !linkedThreadIds.has(t.id));

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">嘉立创办公</div>

      <button className="new-task-btn" onClick={() => navigate('/')}>
        + 新任务
      </button>

      <button className="drive-entry" onClick={() => navigate('/drive')}>
        🗂 个人网盘
      </button>

      <button className="drive-entry" onClick={() => navigate('/schedules')}>
        ⏰ 定时任务
      </button>

      {isDesktop() && (
        <>
          <div className="sidebar-section-row">
            <span className="sidebar-section">项目</span>
            <button
              className="sidebar-section-add"
              title="新建项目"
              onClick={() => {
                setEditingProject(null);
                setProjectModalOpen(true);
              }}
            >
              +
            </button>
          </div>
          <div className="project-list">
            {projects.length === 0 ? (
              <div className="task-list-empty">暂无项目</div>
            ) : (
              sortedProjects.map(p => (
                <ProjectItem
                  key={p.id}
                  project={p}
                  tasks={tasks}
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
          <div className="sidebar-section">最近任务</div>
        </>
      )}
      {!isDesktop() && <div className="sidebar-section">最近任务</div>}
      <div className="task-list">
        {loading ? (
          <div className="task-list-empty">加载中…</div>
        ) : recentTasks.length === 0 ? (
          <div className="task-list-empty">
            {selectedProject ? '该项目下暂无任务' : '还未创建过任务'}
          </div>
        ) : (
          recentTasks.map(task => <TaskListItem key={task.id} task={task} />)
        )}
      </div>

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
        <div>
          <div className="sidebar-username">god</div>
          <div className="sidebar-plan">个人免费版</div>
        </div>
      </div>
    </aside>
  );
}
