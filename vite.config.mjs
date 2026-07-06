import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** @type {import('vite').UserConfig} */
export default {
  plugins: [react(), tailwindcss()],
  root: ".",
  publicDir: "public",
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
};


