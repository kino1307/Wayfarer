import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '')
  const port = env.PORT ?? '3001'

  return {
    plugins: [react()],
    envDir: '..',
    server: {
      port: 5173,
      proxy: {
        '/api': {
          // 127.0.0.1, not localhost — avoids Node's happy-eyeballs dual-stack
          // connect (ENOBUFS on some setups) when proxying to the API.
          target: `http://127.0.0.1:${port}`,
          changeOrigin: true,
        },
      },
    },
  }
})
