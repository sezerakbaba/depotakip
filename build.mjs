// S8 build pipeline — JS bundle (esbuild) + CSS concat (postcss).
// Çıktı: public/dist/  (opt-in; index.html geliştirmede kaynağı kullanır).
//   node build.mjs        → JS + CSS
//   node build.mjs js     → yalnız JS
//   node build.mjs css    → yalnız CSS
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import esbuild from 'esbuild';
import postcss from 'postcss';
import postcssImport from 'postcss-import';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB = join(__dirname, 'public');
const DIST = join(PUB, 'dist');

const only = process.argv[2]; // 'js' | 'css' | undefined(=ikisi)

async function buildJS() {
  const r = await esbuild.build({
    entryPoints: [join(PUB, 'js', 'main.js')],
    bundle: true,
    format: 'iife',           // tek <script> (type=module gerekmez)
    target: ['es2020'],
    minify: true,
    sourcemap: true,
    legalComments: 'none',
    outfile: join(DIST, 'app.min.js'),
    logLevel: 'warning',
  });
  const { size } = await stat(join(DIST, 'app.min.js'));
  console.log(`  JS  → dist/app.min.js  (${(size / 1024).toFixed(1)} KB)`);
  return r;
}

async function buildCSS() {
  // tokens.css + style.css (style.css parts/*'ı @import ediyor) tek dosyada birleşir.
  const entry = `@import 'tokens.css';\n@import 'style.css';\n`;
  const from = join(PUB, 'css', '_build-entry.css'); // postcss-import çözümü için sanal yol
  const out = await postcss([
    postcssImport(),
    autoprefixer(),
    cssnano({ preset: 'default' }),
  ]).process(entry, { from, to: join(DIST, 'app.min.css'), map: { inline: false } });
  await writeFile(join(DIST, 'app.min.css'), out.css, 'utf8');
  if (out.map) await writeFile(join(DIST, 'app.min.css.map'), out.map.toString(), 'utf8');
  const { size } = await stat(join(DIST, 'app.min.css'));
  console.log(`  CSS → dist/app.min.css (${(size / 1024).toFixed(1)} KB)`);
}

async function main() {
  await mkdir(DIST, { recursive: true });
  console.log('build →');
  if (only !== 'css') await buildJS();
  if (only !== 'js') await buildCSS();
  console.log('bitti ✓');
}

main().catch((e) => {
  console.error('build HATASI:', e.message);
  process.exit(1);
});
