import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Production builds get a strict CSP: the app can only load its own files (no CDN, no telemetry, no network). */
const strictCsp = (): Plugin => ({
  name: 'strict-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const csp =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
    return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
  },
});

// 100 % local: fonts bundled from @fontsource, dev server bound to 127.0.0.1.
export default defineConfig({
  plugins: [react(), tailwindcss(), strictCsp()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    // the extracted knowledge (data/*.json, ≈ 4.5 MB: 1 500 nodes with their provenance) is its own chunk
    chunkSizeWarningLimit: 4800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\/]data[\/](graph|docs|stats)\.json$/.test(id)) return 'data';
          if (/node_modules[\/](cytoscape|cytoscape-fcose|cytoscape-dagre|cytoscape-svg|cose-base|layout-base|dagre|graphlib)[\/]/.test(id)) return 'graph';
          if (/node_modules[\/](react-markdown|remark-|micromark|mdast-|unified|hast-|unist-)/.test(id)) return 'markdown';
          if (/node_modules[\/](react|react-dom|react-router|react-router-dom|framer-motion|scheduler)[\/]/.test(id)) return 'react';
        },
      },
    },
  },
});
