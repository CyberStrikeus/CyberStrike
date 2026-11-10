import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: Number(process.env.PORT) || 3000,
    strictPort: true,
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
