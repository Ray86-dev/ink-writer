// Genera ../index.html: un único archivo autónomo, sin red ni servidor.
// Uso: desde esta carpeta, `npm i three esbuild @fontsource-variable/literata @fontsource-variable/instrument-sans`
// y luego `node build.mjs`.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nm = process.env.INK_NODE_MODULES || join(here, 'node_modules');
const b64 = (p) => readFileSync(join(nm, p)).toString('base64');

const face = (family, file, range) =>
  `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:${range};src:url(data:font/woff2;base64,${b64(file)}) format("woff2-variations")}`;

const fonts = [
  face('Literata Variable', '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2', '200 900'),
  face('Instrument Sans Variable', '@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2', '400 700')
].join('\n');

const out = await build({
  entryPoints: [join(here, 'main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  nodePaths: [nm],
  legalComments: 'none',
  banner: { js: '/* three.js (c) 2010-present three.js authors, MIT License. Literata e Instrument Sans: SIL OFL 1.1. */' }
});
const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = readFileSync(join(here, 'template.html'), 'utf8')
  .replace('/*__FONTS__*/', () => fonts)
  .replace('/*__BUNDLE__*/', () => js);
writeFileSync(join(here, '..', 'index.html'), html);
console.log('index.html', Math.round(html.length / 1024), 'KB');
