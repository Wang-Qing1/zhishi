import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 开发服务器要求固定端口(与 tauri.conf.json 的 devUrl 一致)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'chrome105', outDir: 'dist' },
});
