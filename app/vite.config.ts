import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发期把后端 API 统一代理到 Mastra server:
// /chat(对话流)、/api(Mastra 内置 REST)、/drive(网盘)、/schedules(定时任务)
// 注意:后端新增路由前缀时,这里必须同步添加,否则前端会拿到 HTML 导致 JSON 解析报错
export default defineConfig({
  // base 相对路径:桌面壳以 file:// 加载 dist 产物(M6)
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/chat': 'http://localhost:4111',
      '/api': 'http://localhost:4111',
      '/drive': 'http://localhost:4111',
      '/schedules': 'http://localhost:4111',
    },
  },
});
