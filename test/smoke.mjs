// Smoke + API regresyon testi — sunucuyu GEÇİCİ bir veritabanıyla başlatır
// (gerçek database.sqlite / backups'a dokunmaz), kritik yolları doğrular.
// node test/smoke.mjs   (npm test)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Tarih sınırı hatalarını (UTC+3 gece yarısı) yakalamak için sabit saat dilimi.
process.env.TZ = 'Europe/Istanbul';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.SMOKE_PORT || 3899;
const TOKEN = 'smoke-test-token';
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), 'depotakip-test-'));

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    APP_TOKEN: TOKEN,
    DB_PATH: join(TMP, 'test.sqlite'),
    BACKUP_DIR: join(TMP, 'backups'),
  },
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
  server.once('exit', () => {
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {
      // geçici dizin silinemezse (Windows kilidi) sorun değil
    }
  });
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

const AUTH = { Authorization: 'Bearer ' + TOKEN };
async function api(method, action, { body, query = '' } = {}) {
  const r = await fetch(`${BASE}/api?action=${action}${query}`, {
    method,
    headers: { ...AUTH, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json() };
}
const get = (action, query) => api('GET', action, { query });
const post = (action, body) => api('POST', action, { body: body ?? {} });

const pad2 = (n) => String(n).padStart(2, '0');
const localISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// ── Statik / yetki kontrolleri ──────────────────────────────────────────
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
    headers: AUTH,
  },
];

// ── API regresyon testleri ──────────────────────────────────────────────
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

test('hareket_list: 500+ kayıt sınırsız dışa aktarılabilir (limit 500\'e kırpılmaz)', async () => {
  const bugun = localISODate(new Date());
  const hareketler = Array.from({ length: 600 }, (_, i) => ({
    tarih: bugun,
    tur: i % 2 ? 'Giriş' : 'Çıkış',
    depo: 'Test Deposu',
    malzeme: 'Toplu ' + i,
    miktar: 1,
  }));
  const r = await post('hareket_toplu_ekle', { hareketler });
  assert(r.json.ok && r.json.eklenen === 600, 'toplu ekleme başarısız: ' + JSON.stringify(r.json));
  const l = await get('hareket_list', '&limit=999999');
  assert(l.json.ok, 'liste hata: ' + l.json.error);
  assert(l.json.hareketler.length === 600, `600 beklenirdi, ${l.json.hareketler.length} döndü`);
  assert(l.json.toplam === 600, 'toplam 600 olmalı');
});

test('tarih sınırı: yerel gece 01:30 kaydı "bugün" sayılır (UTC\'ye kaymaz)', async () => {
  const now = new Date();
  const gece = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 30);
  const bugun = localISODate(now);
  const r = await post('hareket_ekle', {
    tarih: gece.toISOString(), tur: 'Giriş', depo: 'Gece Deposu', malzeme: 'Gece Malı', miktar: 3,
  });
  assert(r.json.ok, 'ekleme başarısız');
  const l = await get('hareket_list', `&depo=${encodeURIComponent('Gece Deposu')}&tarih_min=${bugun}&tarih_max=${bugun}`);
  assert(l.json.toplam === 1, `tarih filtresi kaydı bulamadı (toplam=${l.json.toplam})`);
  const ist = await get('istatistik');
  assert(ist.json.ok && ist.json.ozet.bugunGiris >= 1, 'bugunGiris gece kaydını saymadı');
});

test('istatistik: ayın 1\'i 00:30 kaydı doğru ayın trendine yazılır', async () => {
  const now = new Date();
  const ilkGun = new Date(now.getFullYear(), now.getMonth(), 1, 0, 30);
  const r = await post('hareket_ekle', {
    tarih: ilkGun.toISOString(), tur: 'Giriş', depo: 'Ay Deposu', malzeme: 'Ay Malı', miktar: 7,
  });
  assert(r.json.ok, 'ekleme başarısız');
  const ist = await get('istatistik');
  const trend = ist.json.trend;
  assert(trend.length === 6, 'trend 6 ay olmalı');
  const onceki = trend[4].giris, bu = trend[5].giris;
  // Bu ay: toplu 300 Giriş (1'er) + gece 3 + ay-başı 7 = 310; önceki ay boş olmalı.
  assert(bu === 310, `bu ay giriş 310 olmalı, ${bu} (önceki ay: ${onceki})`);
  assert(onceki === 0, `önceki ay 0 olmalı, ${onceki} — kayıt ay kaydı hatası`);
});

test('reset sonrası save: version sıfırlanır, istemci 0 ile kaydedebilir', async () => {
  const s1 = await post('save', { stok: { a: 1 }, _version: 0 });
  assert(s1.json.ok && s1.json.version === 1, 'ilk save başarısız');
  const rs = await post('reset');
  assert(rs.json.ok, 'reset başarısız');
  const ld = await get('load');
  assert(ld.json.version === 0, 'reset sonrası version 0 olmalı, ' + ld.json.version);
  const eski = await post('save', { stok: {}, _version: 1 });
  assert(eski.status === 409, 'eski version 409 almalı, ' + eski.status);
  const yeni = await post('save', { stok: {}, _version: 0 });
  assert(yeni.json.ok, 'version 0 ile save başarılı olmalı');
});

test('eşzamanlı yazmalar: tek bağlantıda transaction çakışması olmaz', async () => {
  const bugun = localISODate(new Date());
  const istekler = [];
  for (let i = 0; i < 20; i++) {
    istekler.push(post('save', { stok: { ['k' + i]: i } }));
    istekler.push(post('talep_kaydet', { tarih: bugun, birim: 'B' + i, personel: 'P', durum: 'Taslak' }));
    istekler.push(post('hareket_ekle', { tarih: bugun, tur: 'Giriş', depo: 'D', malzeme: 'M' + i, miktar: 1 }));
  }
  const sonuclar = await Promise.all(istekler);
  const basarisiz = sonuclar.filter((r) => !r.json.ok);
  assert(!basarisiz.length, `${basarisiz.length} istek başarısız: ${JSON.stringify(basarisiz[0]?.json)}`);
  const talepler = sonuclar.filter((r) => r.json.no).map((r) => r.json.no);
  assert(new Set(talepler).size === 20, 'talep numaraları benzersiz olmalı: ' + talepler.length);
  const l = await get('hareket_list', '&limit=100');
  assert(l.json.toplam === 20, `20 hareket beklenirdi, ${l.json.toplam}`);
});

test('hareket_toplu_ekle: geçersiz satırlar atlanır, degistir tekrarı önler', async () => {
  const bugun = localISODate(new Date());
  const iyi = (m) => ({ tarih: bugun, tur: 'Giriş', depo: 'D', malzeme: m, miktar: 2 });
  const r = await post('hareket_toplu_ekle', {
    degistir: true,
    hareketler: [
      iyi('A'), iyi('B'),
      { ...iyi('neg'), miktar: -5 },
      { ...iyi('sifir'), miktar: 0 },
      { ...iyi('tur'), tur: 'Bilinmeyen' },
      { ...iyi('tarih'), tarih: 'dun' },
      { tarih: bugun, tur: 'Giriş', depo: 'D', malzeme: 'nan', miktar: 'x' },
      null,
    ],
  });
  assert(r.json.ok && r.json.eklenen === 2 && r.json.atlanan === 6, 'beklenmeyen sonuç: ' + JSON.stringify(r.json));
  // aynı yüklemeyi tekrar: degistir:true → kayıt sayısı artmaz
  await post('hareket_toplu_ekle', { degistir: true, hareketler: [iyi('A'), iyi('B')] });
  const l = await get('hareket_list', '&limit=100');
  assert(l.json.toplam === 2, `tekrar yüklemede 2 kayıt kalmalı, ${l.json.toplam}`);
  // hepsi geçersizse mevcut kayıtlar silinmez
  const kotu = await post('hareket_toplu_ekle', { degistir: true, hareketler: [{ miktar: -1 }] });
  assert(kotu.status === 400, 'tümü geçersizse 400 beklenirdi, ' + kotu.status);
  const l2 = await get('hareket_list', '&limit=100');
  assert(l2.json.toplam === 2, 'geçersiz yüklemede mevcut kayıtlar korunmalı');
});

test('hareket_sil: ikinci silme 404 döner (stok çift düzeltilmesin)', async () => {
  const e = await post('hareket_ekle', { tarih: localISODate(new Date()), tur: 'Çıkış', depo: 'D', malzeme: 'Sil', miktar: 1 });
  assert(e.json.ok, 'ekleme başarısız');
  const s1 = await post('hareket_sil', { id: e.json.id });
  assert(s1.json.ok, 'ilk silme başarılı olmalı');
  const s2 = await post('hareket_sil', { id: e.json.id });
  assert(s2.status === 404 && !s2.json.ok, 'ikinci silme 404 olmalı, ' + s2.status);
});

test('talep_guncelle/talep_durum: olmayan id → 404', async () => {
  const g = await post('talep_guncelle', { id: 99999, tarih: localISODate(new Date()), durum: 'Taslak' });
  assert(g.status === 404, 'talep_guncelle 404 olmalı, ' + g.status);
  const d = await post('talep_durum', { id: 99999, durum: 'Onaylı' });
  assert(d.status === 404, 'talep_durum 404 olmalı, ' + d.status);
});

test('yedek: oluştur → geçici dosya kalmaz; bozuk satırlı yedek yüklenebilir', async () => {
  await post('save', { stok: { z: 1 } });
  const b = await post('backup_olustur');
  assert(b.json.ok && /^backup_.*\.json$/.test(b.json.dosya), 'yedek oluşturulamadı: ' + JSON.stringify(b.json));
  const dosyalar = readdirSync(join(TMP, 'backups'));
  assert(!dosyalar.some((f) => f.endsWith('.tmp')), 'geçici .tmp dosyası kalmamalı: ' + dosyalar);

  // Elle bozulmuş yedek: 1 geçerli + 2 bozuk hareket, 1 bozuk talep
  const bozuk = 'backup_2020-01-01T00-00-00.json';
  writeFileSync(join(TMP, 'backups', bozuk), JSON.stringify({
    stok: { q: 1 },
    _hareketler: [
      { tarih: '2020-01-01', tur: 'Giriş', depo: 'D', malzeme: 'M', miktar: 4 },
      { tarih: '2020-01-01', tur: 'Giriş', depo: null, malzeme: 'M', miktar: 4 },
      { tarih: '2020-01-01', tur: '??', depo: 'D', malzeme: 'M', miktar: 1 },
    ],
    _talepler: [{ no: 'TLN-0001', tarih: '2020-01-01', satirlar: '[]' }, { tarih: 'x' }],
  }));
  const y = await post('backup_yukle', { dosya: bozuk });
  assert(y.json.ok, 'bozuk satırlı yedek yüklenemedi: ' + JSON.stringify(y.json));
  assert(y.json.atlanan.hareket === 2 && y.json.atlanan.talep === 1, 'atlanan sayıları: ' + JSON.stringify(y.json.atlanan));
  const l = await get('hareket_list', '&limit=100');
  assert(l.json.toplam === 1, `1 hareket geri yüklenmeliydi, ${l.json.toplam}`);
  const ld = await get('load');
  assert(ld.json.version === 0 && ld.json.data.stok?.q === 1, 'AppState geri yüklenmeli');
});

test('hata yanıtları JSON: bozuk gövde 400, yetkisiz büyük gövde 401', async () => {
  const bozuk = await fetch(`${BASE}/api?action=save`, {
    method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: '{bozuk',
  });
  const j = await bozuk.json();
  assert(bozuk.status === 400 && j.ok === false, `bozuk JSON → 400 JSON beklenirdi, ${bozuk.status}`);
  const yetkisiz = await fetch(`${BASE}/api?action=save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stok: {}, dolgu: 'x'.repeat(1_000_000) }),
  });
  assert(yetkisiz.status === 401, 'token yoksa gövde ayrıştırılmadan 401 dönmeli, ' + yetkisiz.status);
});

// En sonda: IP'nin sınırını tüketir
test('brute-force koruması: art arda geçersiz token → 429', async () => {
  let sinirlandi = false;
  for (let i = 0; i < 40 && !sinirlandi; i++) {
    const r = await fetch(`${BASE}/api?action=load`, { headers: { Authorization: 'Bearer yanlis-' + i } });
    sinirlandi = r.status === 429;
  }
  assert(sinirlandi, '40 geçersiz denemeden sonra 429 beklenirdi');
  // Geçerli token ise sınırlanmamalı
  const ok = await get('load');
  assert(ok.status === 200, 'geçerli token sınırlanmamalı, ' + ok.status);
});

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
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✓ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`✗ ${t.name}\n    ${e.message}`);
    }
  }
  if (failed) {
    console.error(`\nsmoke FAIL: ${failed} kontrol başarısız`);
    if (serverErr) console.error(serverErr);
    cleanup(1);
    return;
  }
  console.log('\nsmoke OK ✓');
  cleanup(0);
}

run().catch((e) => {
  console.error('smoke HATASI:', e.message);
  cleanup(1);
});
