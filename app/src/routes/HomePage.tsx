import { useNavigate } from 'react-router-dom';
import { TaskInput } from '../components/TaskInput';
import { useTaskStore } from '../lib/taskStore';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function HomePage() {
  const navigate = useNavigate();
  const createTask = useTaskStore(s => s.createTask);

  const handleSubmit = (text: string) => {
    // 创建任务(乐观插入列表)→ 带首条消息跳转到任务视图,
    // TaskPage 会把它作为第一条消息自动发出(plan 模块交互)
    const id = createTask(text);
    navigate(`/task/${id}`, { state: { initialMessage: text } });
  };

  return (
    <div className="home-page">
      <div className="home-hero">
        <h1 className="home-greeting">
          {greeting()},god
          <br />
          准备好创建点什么了吗?
        </h1>
        <TaskInput onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
