import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // The design tokens live in docs/design, outside this package.
    fs: { allow: ["../.."] },
  },
  build: {
    // What the system WebViews of Windows, macOS and Linux all support.
    target: ["es2022", "safari16"],
  },
});
