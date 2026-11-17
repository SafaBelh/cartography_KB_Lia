import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts: vitest 2 ships its own Vite types.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
