// API 基址(M6 桌面端)
// 开发模式:空串 → 走 Vite 代理(5173 → 4111)
// 生产构建(桌面壳加载 dist):直连本机 Mastra server,可用 VITE_API_BASE 覆盖
export const API_BASE: string = import.meta.env.DEV
  ? ''
  : ((import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:4111');
