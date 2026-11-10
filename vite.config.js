import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const base = process.env.VITE_BASE || "/albert-speech2text/";
const siteUrl = (
  process.env.VITE_SITE_URL || "https://xiaoouwang.github.io/albert-speech2text"
).replace(/\/+$/, "");

export default defineConfig({
  base,
  plugins: [
    react(),
    {
      name: "html-site-url",
      transformIndexHtml(html) {
        return html.replaceAll(
          "https://xiaoouwang.github.io/albert-speech2text",
          siteUrl,
        );
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
