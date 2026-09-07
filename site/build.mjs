import { mkdir, copyFile, rm } from 'node:fs/promises';

/** The landing page is a single self-contained file: markup, styles and
 *  behaviour all travel together. Only the favicon rides alongside. */
const assets = ['index.html', 'favicon.png'];

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of assets) await copyFile(file, `dist/${file}`);
console.log(`Static landing page built in dist/ (${assets.join(', ')})`);
