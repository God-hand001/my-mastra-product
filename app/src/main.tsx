import { createRoot } from 'react-dom/client';
import '@assistant-ui/react-ui/styles/index.css';
import '@assistant-ui/react-ui/styles/markdown.css';

function App() {
  return <div style={{ padding: 40 }}>千问助手 · 骨架占位</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
