// API 基址(M6 桌面端)
// 开发模式:空串 → 走 Vite 代理(5173 → 4111)
// 生产构建(桌面壳加载 dist):走 Electron 自定义协议 appapi://
// (主进程转发到本机 4111,绕开 file:// → http://localhost 的 PNA/CORS 拦截),
// 可用 VITE_API_BASE 覆盖(如指向远程部署的 Mastra server)
export const API_BASE: string = import.meta.env.DEV
  ? ''
  : ((import.meta.env.VITE_API_BASE as string | undefined) ?? 'appapi://local');
