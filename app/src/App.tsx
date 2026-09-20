import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './routes/HomePage';
import { TaskPage } from './routes/TaskPage';
import { DrivePage } from './routes/DrivePage';
import { SchedulesPage } from './routes/SchedulesPage';
import { ExtensionsPage } from './routes/ExtensionsPage';
import { ModelsPage } from './routes/ModelsPage';
import { PreviewWindowPage } from './routes/PreviewWindowPage';
import { TaskStoreProvider } from './lib/taskStore';
import { useEffect, useState } from 'react';
import { isDesktop } from './lib/desktop';
import { listProjects, type Project } from './lib/projectsClient';

// AppShell:左侧栏固定宽 + 右侧主区滚动;预览弹窗路由单独渲染。
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const location = useLocation();
  const isPreviewWindow = location.pathname.startsWith('/preview-window');

  // H0:项目列表(仅桌面端);新建/删除项目后通过事件刷新
  useEffect(() => {
    if (!isDesktop()) return;
    const refresh = () => listProjects().then(setProjects).catch(() => {});
    refresh();
    window.addEventListener('h0-projects-changed', refresh);
    return () => window.removeEventListener('h0-projects-changed', refresh);
  }, []);

  if (isPreviewWindow) {
    return (
      <TaskStoreProvider>
        <Routes>
          <Route path="/preview-window/:tabId" element={<PreviewWindowPage />} />
        </Routes>
      </TaskStoreProvider>
    );
  }

  return (
    <TaskStoreProvider>
      <div className="app-shell">
        <Sidebar projects={projects} />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage projects={projects} />} />
            <Route path="/task/:id" element={<TaskPage projects={projects} />} />
            <Route path="/drive" element={<DrivePage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/extensions" element={<ExtensionsPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </TaskStoreProvider>
  );
}
