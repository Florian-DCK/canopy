import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // Deux points d'entrée : le main d'Electron et le démon (lancé à part par ELECTRON_RUN_AS_NODE).
    build: {
      externalizeDeps: true,
      rollupOptions: { input: { index: 'src/main/index.ts', daemon: 'src/daemon/index.ts' } }
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: { input: { index: 'src/preload/index.ts', webview: 'src/preload/webview.ts' } }
    }
  },
  renderer: {
    plugins: [react()],
    // Deux pages : l'application et la fenêtre des notifications (toast.html, planche 9).
    build: { rollupOptions: { input: { index: 'src/renderer/index.html', toast: 'src/renderer/toast.html' } } }
  }
})
