const { app, BrowserWindow, Menu, protocol, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// M6 轻量壳:--dev 加载 Vite(5173,热更新);否则加载 app/dist 构建产物
// 后端(4111)由用户手动启动;未启动时展示提示页(N1)
// 渲染层 API 一律走 appapi:// 自定义协议 → 主进程转发到 4111
// (file:// 渲染进程直连 http://localhost 会被 Chromium PNA/CORS 间歇拦截,故用协议通道根治)
const DEV = process.argv.includes('--dev');
const API_ORIGIN = 'http://localhost:4111';

// 必须在 app ready 前注册
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'appapi',
    privileges: { standard: true, supportFetchAPI: true, stream: true, corsEnabled: true, secure: true },
  },
]);

function registerApiProtocol() {
  protocol.handle('appapi', async req => {
    try {
      const u = new URL(req.url);
      const target = `${API_ORIGIN}${u.pathname}${u.search}`;
      const headers = {};
      for (const [k, v] of req.headers) headers[k] = v;
      delete headers.origin;
      delete headers.referer;
      const res = await fetch(target, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
        // 转发流式请求体(如线程订阅 SSE)时 undici 要求显式 duplex
        ...(req.body ? { duplex: 'half' } : {}),
      });
      const out = new Headers(res.headers);
      out.set('access-control-allow-origin', '*');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
    } catch (err) {
      console.log('[appapi-error]', req.url, err?.message ?? err);
      return new Response(JSON.stringify({ error: `网关请求失败: ${err?.message ?? err}` }), {
        status: 502,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      });
    }
  });
}

let win;

function backendUp() {
  return fetch(`${API_ORIGIN}/api/agents`, { signal: AbortSignal.timeout(1500) })
    .then(res => res.ok)
    .catch(() => false);
}

function localPage(html) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function backendDownHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>嘉立创Work</title></head>
<body style="font-family:system-ui,'Microsoft YaHei',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f7f8fa;color:#1f2329">
  <div style="text-align:center">
    <div style="font-size:52px">🔌</div>
    <h2 style="margin:12px 0 8px">后端服务未启动</h2>
    <p style="color:#86909c;font-size:14px;margin:0 0 20px">
      请先在项目根目录运行 <code style="background:#eceef1;padding:2px 8px;border-radius:6px">npm run dev</code>(端口 4111),然后点击重试
    </p>
    <button onclick="location.reload()" style="padding:10px 26px;border:none;border-radius:10px;background:#30bf69;color:#fff;font-size:14px;cursor:pointer">重试</button>
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
    title: '嘉立创Work',
    // 嘉立创专属图标(由 logo PNG 打包的 ICO;缺省时 Electron 用默认图标)
    ...(fs.existsSync(path.join(__dirname, 'icon.ico')) ? { icon: path.join(__dirname, 'icon.ico') } : {}),
    webPreferences: {
      contextIsolation: true,
      // H0:目录选择桥(preload → ipcMain)
      preload: path.join(__dirname, 'preload.js'),
      // 本地壳:file:// → http://localhost 受 Chromium 私有网络访问保护(PNA)拦截,
      // 纯本地单机应用关闭该检查以放行 API 请求(壳内只加载本地构建产物)。
      // 注意:该设置只影响主窗口,webview 通过自身 webpreferences 属性恢复隔离,不会继承此设置。
      webSecurity: false,
      // M6:启用 webview 标签,为内置浏览器提供网页渲染能力
      webviewTag: true,
    },
  });
  // 渲染进程报错转发到主进程 stdout(桌面端排障用)
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log('[did-fail-load]', code, desc, url);
  });
  win.webContents.session.webRequest.onErrorOccurred(details => {
    console.log('[req-error]', details.error, details.url);
  });
  loadApp();
  win.on('page-title-updated', e => e.preventDefault());
}

app.whenReady().then(() => {
  // 去掉 File/Edit/View 原生菜单栏(Electron 默认菜单),对齐千问办公的简洁顶栏
  Menu.setApplicationMenu(null);
  // H0:打开项目文件夹
  ipcMain.handle('open-path', async (_e, dir) => {
    return shell.openPath(dir);
  });
  // H0:原生文件夹选择框(桌面端新建项目用)
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '选择工作目录',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  registerApiProtocol();

  // M6:为内置浏览器施加安全约束,仅作用于 webview,不影响主窗口
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    // 页面内 target=_blank 等新开窗口请求不弹出系统窗口,由渲染层在产品内处理
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // 拦截页面内导航,仅允许 http/https,兜住用户点击非法链接的场景
    contents.on('will-navigate', (event, url) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          event.preventDefault();
          console.log('[webview-blocked]', url);
        }
      } catch {
        event.preventDefault();
        console.log('[webview-blocked-invalid]', url);
      }
    });
  });

  createWindow();
});
app.on('window-all-closed', () => app.quit());
