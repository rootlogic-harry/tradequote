/**
 * Bundle the client-link quote PDF renderer to plain ESM.
 * server.js cannot import QuoteDocument.jsx directly. The Docker
 * build runs this before the process starts, same as the PDF CSS.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'server-dist', 'quotePdfRender.js');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/quotePdfRenderEntry.jsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/server'],
  logLevel: 'info',
});
