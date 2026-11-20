// Bundles the three entry points into dist/. Run by `npm run build`.
import { build } from 'esbuild';
await build({
  entryPoints: { server: 'src/server.ts', 'mcp-stdio': 'src/mcp-stdio.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
