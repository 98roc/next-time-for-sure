import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const environment = loadEnv(mode, root, '');
  const port = Number(process.env.WEB_PORT || environment.WEB_PORT || '5174');
  // 显式保留浏览器Host；字符串代理快捷写法会改写Host，使同源写入被后端拒绝。
  const proxy = { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || environment.API_PORT || '3100'}`, changeOrigin: false } };
  return {
    plugins: [react()],
    envDir: root,
    // 只有VITE_前缀变量才会进入浏览器；数据库配置不注入前端。
    server: { port, strictPort: true, proxy },
    preview: { port, strictPort: true, proxy },
  };
});
