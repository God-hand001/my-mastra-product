import { matchPath, useLocation, useNavigate } from 'react-router-dom';
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

export function Sidebar() {
  const navigate = useNavigate();
  const { tasks, loading } = useTaskStore();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">嘉立创办公</div>

      <button className="new-task-btn" onClick={() => navigate('/')}>
        + 新任务
      </button>

      <button className="drive-entry" onClick={() => navigate('/drive')}>
        🗂 个人网盘
      </button>

      <div className="sidebar-section">最近任务</div>
      <div className="task-list">
        {loading ? (
          <div className="task-list-empty">加载中…</div>
        ) : tasks.length === 0 ? (
          <div className="task-list-empty">还未创建过任务</div>
        ) : (
          tasks.map(task => <TaskListItem key={task.id} task={task} />)
        )}
      </div>

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
