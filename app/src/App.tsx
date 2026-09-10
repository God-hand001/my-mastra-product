import { Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './routes/HomePage';
import { TaskPage } from './routes/TaskPage';
import { DrivePage } from './routes/DrivePage';
import { SchedulesPage } from './routes/SchedulesPage';
import { TaskStoreProvider } from './lib/taskStore';
import { useEffect, useState } from 'react';
import { isDesktop } from './lib/desktop';
import { listProjects, type Project } from './lib/projectsClient';

// AppShell:左侧栏固定宽 + 右侧主区滚动(plan 模块设计)
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);

  // H0:项目列表(仅桌面端);新建/删除项目后通过事件刷新
  useEffect(() => {
    if (!isDesktop()) return;
    const refresh = () => listProjects().then(setProjects).catch(() => {});
    refresh();
    window.addEventListener('h0-projects-changed', refresh);
    return () => window.removeEventListener('h0-projects-changed', refresh);
  }, []);

  return (
    <TaskStoreProvider>
      <div className="app-shell">
        <Sidebar projects={projects} />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage projects={projects} />} />
            <Route path="/task/:id" element={<TaskPage />} />
            <Route path="/drive" element={<DrivePage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </TaskStoreProvider>
  );
}
