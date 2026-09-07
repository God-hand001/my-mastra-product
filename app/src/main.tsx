import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@assistant-ui/react-ui/styles/index.css';
import '@assistant-ui/react-ui/styles/markdown.css';
import './styles/app.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
