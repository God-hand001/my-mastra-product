import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发期把后端 API 统一代理到 Mastra server:
// /chat(对话流)、/api(Mastra 内置 REST)、/drive(网盘)、/schedules(定时任务)、
// /messages(重新生成后清理旧回复)
// 注意:后端新增路由前缀时,这里必须同步添加,否则前端会拿到 HTML 导致 JSON 解析报错
export default defineConfig({
  // base 相对路径:桌面壳以 file:// 加载 dist 产物(M6)
  base: './',
  plugins: [react()],
  build: {
    // 桌面壳以 file:// 加载:file:// 下动态 import 分包会被 CORS 拦截,故内联为单文件
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  server: {
    port: 5173,
    proxy: {
      '/chat': 'http://localhost:4111',
      '/api': 'http://localhost:4111',
      '/drive': 'http://localhost:4111',
      '/schedules': 'http://localhost:4111',
      '/messages': 'http://localhost:4111',
      // 右侧预览栏用:工作区文件列表/内容/原始字节/文档转换
      '/workspace': 'http://localhost:4111',
      // 上下文用量、手动压缩、任务摘要
      '/threads': 'http://localhost:4111',
      // 项目系统(桌面端项目目录绑定)
      '/projects': 'http://localhost:4111',
    },
  },
});
