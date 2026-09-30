import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Everything (code, physics engine, styles) is bundled into one self-contained HTML file,
// so the game can be opened straight from disk with a double-click.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 5000,
    reportCompressedSize: false,
  },
});
