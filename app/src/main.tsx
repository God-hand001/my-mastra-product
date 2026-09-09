import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles/app.css';
import App from './App';

// HashRouter:浏览器(5173)与桌面壳(file:// 加载 dist)双环境可用
createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <App />
  </HashRouter>,
);
