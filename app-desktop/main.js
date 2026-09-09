const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// M6 轻量壳:--dev 加载 Vite(5173,热更新);否则加载 app/dist 构建产物
// 后端(4111)由用户手动启动;未启动时展示提示页(N1)
const DEV = process.argv.includes('--dev');
const API_BASE = 'http://localhost:4111';

let win;

function backendUp() {
  return fetch(`${API_BASE}/api/agents`, { signal: AbortSignal.timeout(1500) })
    .then(res => res.ok)
    .catch(() => false);
}

function localPage(html) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function backendDownHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>嘉立创办公</title></head>
<body style="font-family:system-ui,'Microsoft YaHei',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f7f8fa;color:#1f2329">
  <div style="text-align:center">
    <div style="font-size:52px">🔌</div>
    <h2 style="margin:12px 0 8px">后端服务未启动</h2>
    <p style="color:#86909c;font-size:14px;margin:0 0 20px">
      请先在项目根目录运行 <code style="background:#eceef1;padding:2px 8px;border-radius:6px">npm run dev</code>(端口 4111),然后点击重试
    </p>
    <button onclick="location.reload()" style="padding:10px 26px;border:none;border-radius:10px;background:#1c7dff;color:#fff;font-size:14px;cursor:pointer">重试</button>
  </div>
</body></html>`;
}

function distIndex() {
  // 开发运行:../app/dist;打包后:resources/dist(electron-builder extraFiles)
  const candidates = [
    path.join(__dirname, '..', 'app', 'dist', 'index.html'),
    path.join(process.resourcesPath, 'dist', 'index.html'),
  ];
  return candidates.find(p => fs.existsSync(p));
}

async function loadApp() {
  if (await backendUp()) {
    if (DEV) {
      win.loadURL('http://localhost:5173');
      return;
    }
    const index = distIndex();
    if (index) {
      win.loadFile(index);
    } else {
      win.loadURL(
        localPage(
          '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding-top:40vh">未找到前端构建产物:请先在 app/ 目录执行 <b>npm run build</b></body>',
        ),
      );
    }
  } else {
    win.loadURL(localPage(backendDownHtml()));
    // 后端就绪后自动进入正式界面(N1:免手动重试)
    setTimeout(async () => {
      if (win && !win.isDestroyed() && (await backendUp())) loadApp();
      else if (win && !win.isDestroyed()) loadApp();
    }, 3000);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: '嘉立创办公',
    webPreferences: { contextIsolation: true },
  });
  loadApp();
  win.on('page-title-updated', e => e.preventDefault());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
