import { defineConfig } from 'tsup';

/** Produktions-Bundle: @sd/shared wird eingebettet, alle anderen Abhängigkeiten bleiben extern (node_modules). */
export default defineConfig({
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker.ts',
    migrate: 'src/scripts/migrate-cli.ts',
    seed: 'src/scripts/seed.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  noExternal: ['@sd/shared'],
});
