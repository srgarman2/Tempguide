import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    https: false, // Web Bluetooth requires HTTPS in production; use chrome://flags/#enable-web-bluetooth-new-permissions-backend for local dev
  }
})
