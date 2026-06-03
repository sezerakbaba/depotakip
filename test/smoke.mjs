// S8 smoke test — sunucuyu başlat, kritik yolların 200 döndüğünü doğrula.
// node test/smoke.mjs   (npm test)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.SMOKE_PORT || 3899;
const TOKEN = 'smoke-test-token';
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), APP_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErr = '';
server.stderr.on('data', (d) => (serverErr += d));

function cleanup(code) {
  // process.exit() çağırmıyoruz: Windows'ta fetch(undici) keep-alive
  // soketleri kapanırken zorla çıkış libuv assertion'ı tetikliyor.
  // Bunun yerine exitCode ayarlayıp child'ı öldürüyoruz; event loop
  // boşalınca süreç temiz çıkar (idle soketler kısa sürede kapanır).
  process.exitCode = code;
  if (!server.killed) server.kill();
}

async function waitForServer(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/', { method: 'HEAD' });
      if (r.status) return;
    } catch {
      // henüz dinlemiyor
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Sunucu zamanında başlamadı.\n' + serverErr);
}

const checks = [
  { name: 'GET /                 (200)', url: '/', expect: 200 },
  { name: 'GET /css/style.css    (200)', url: '/css/style.css', expect: 200 },
  { name: 'GET /css/parts/base.css(200)', url: '/css/parts/base.css', expect: 200 },
  { name: 'GET /js/main.js       (200)', url: '/js/main.js', expect: 200 },
  { name: 'GET /api (token yok → 401)', url: '/api?action=load', expect: 401 },
  {
    name: 'GET /api (token var → 200)',
    url: '/api?action=load',
    expect: 200,
    headers: { Authorization: 'Bearer ' + TOKEN },
  },
];

async function run() {
  await waitForServer();
  let failed = 0;
  for (const c of checks) {
    let status;
    try {
      status = (await fetch(BASE + c.url, { headers: c.headers || {} })).status;
    } catch (e) {
      status = 'ERR:' + e.message;
    }
    const ok = status === c.expect;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${c.name}  →  ${status}`);
  }
  if (failed) {
    console.error(`\nsmoke FAIL: ${failed} kontrol başarısız`);
    cleanup(1);
  }
  console.log('\nsmoke OK ✓');
  cleanup(0);
}

run().catch((e) => {
  console.error('smoke HATASI:', e.message);
  cleanup(1);
});
