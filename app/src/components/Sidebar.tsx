import { useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { isDesktop } from '../lib/desktop';
import { type Project } from '../lib/projectsClient';
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

function TaskListItem({ task }: { task: TaskThread }) {
  const navigate = useNavigate();
  const { removeTask } = useTaskStore();
  const { pathname } = useLocation();
  const isCurrent = matchPath(`/task/${task.id}`, pathname) != null;

  return (
    <div
      className={`task-list-item${isCurrent ? ' is-current' : ''}`}
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

export function Sidebar({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  const { tasks, loading, links, selectedProject, setSelectedProject } = useTaskStore();
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  // H0:项目功能仅桌面端;选中项目时最近任务按绑定关系过滤
  const visibleTasks = selectedProject
    ? tasks.filter(t => links.some(l => l.threadId === t.id && l.projectId === selectedProject))
    : tasks;

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
              onClick={() => setProjectModalOpen(true)}
            >
              +
            </button>
          </div>
          <div className="project-list">
            {projects.length === 0 ? (
              <div className="task-list-empty">暂无项目</div>
            ) : (
              projects.map(p => (
                <div
                  key={p.id}
                  className={`project-item${selectedProject === p.id ? ' is-current' : ''}`}
                  title={p.dir || p.name}
                  onClick={() =>
                    setSelectedProject(selectedProject === p.id ? null : p.id)
                  }
                >
                  <span className="project-item-name">📁 {p.name}</span>
                </div>
              ))
            )}
          </div>
          <div className="sidebar-section">最近任务{selectedProject ? '(本项目)' : ''}</div>
        </>
      )}
      {!isDesktop() && <div className="sidebar-section">最近任务</div>}
      <div className="task-list">
        {loading ? (
          <div className="task-list-empty">加载中…</div>
        ) : visibleTasks.length === 0 ? (
          <div className="task-list-empty">
            {selectedProject ? '该项目下暂无任务' : '还未创建过任务'}
          </div>
        ) : (
          visibleTasks.map(task => <TaskListItem key={task.id} task={task} />)
        )}
      </div>

      {projectModalOpen && (
        <ProjectModal
          onClose={() => setProjectModalOpen(false)}
          onCreated={() => {
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
