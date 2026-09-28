import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the site and the moderation page (/admin.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
});
