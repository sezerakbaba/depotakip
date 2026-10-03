const express = require('express');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto  = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
// LAN içinde reverse proxy arkasında çalışabilir; rate-limit IP'yi doğru görebilsin diye:
app.set('trust proxy', 'loopback');

const APP_TOKEN = process.env.APP_TOKEN || (() => {
  const tokenFile = path.join(__dirname, '.app-token');
  if (fs.existsSync(tokenFile)) {
    const saved = fs.readFileSync(tokenFile, 'utf8').trim();
    if (saved) {
      console.log('\n🔑 APP_TOKEN .app-token dosyasından yüklendi.\n');
      return saved;
    }
  }
  const t = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(tokenFile, t, { mode: 0o600 });
    console.log('\n⚠  APP_TOKEN ayarlanmamış — rastgele üretildi ve .app-token dosyasına yazıldı:');
    console.log('   ' + t);
    console.log('   Kalıcı/paylaşılabilir yapmak için: APP_TOKEN=<token> node server.js\n');
  } catch (e) {
    console.log('\n⚠  APP_TOKEN üretildi (dosyaya yazılamadı: ' + e.message + '):');
    console.log('   ' + t + '\n');
  }
  return t;
})();

const APP_TOKEN_BUF = Buffer.from(APP_TOKEN);

function hasValidToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  const given = Buffer.from(auth.slice(7));
  return given.length === APP_TOKEN_BUF.length && crypto.timingSafeEqual(given, APP_TOKEN_BUF);
}

function requireToken(req, res, next) {
  if (!hasValidToken(req)) {
    return res.status(401).json({ ok: false, error: 'Yetkisiz erişim' });
  }
  next();
}

// ── Güvenlik middleware'leri ─────────────────────────────────────────────
// CSP politikası: inline JS Aşama 1+2'de temizlendi → script-src 'self'.
// S9 (inline style purge) tamamlandı: tüm inline style="" attribute'leri
// utility class'lara (parts/utilities.css) ve dinamikler data-style →
// el.style.cssText'e taşındı → style-src 'self' ('unsafe-inline' kaldırıldı).
// Chart.js canvas + lucide.min.js + IBM Plex fontları zaten /vendor/'dan
// servis edildiği için 'self' yeterli. data: URI'lar (favicons, SVG
// kritik bildirim ikonu) için img-src 'self' data:.
//
// CSP artık varsayılan olarak ENFORCE edilir (S1 tarayıcı testinde hiçbir
// ihlal raporlanmadı; inline JS Aşama 1+2'de temizlenmişti). Sorun
// çıkarsa geçici olarak CSP_ENFORCE=false ile Report-Only moda dönülebilir.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc:  ["'self'"],
  styleSrc:   ["'self'"], // S9 tamam: inline style kalmadı → 'unsafe-inline' kaldırıldı
  fontSrc:    ["'self'"],
  imgSrc:     ["'self'", 'data:'],
  connectSrc: ["'self'"],
  objectSrc:  ["'none'"],
  baseUri:    ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};
const cspEnforce = process.env.CSP_ENFORCE !== 'false';
app.use(helmet({
  contentSecurityPolicy: {
    directives: CSP_DIRECTIVES,
    reportOnly: !cspEnforce,
  },
  crossOriginEmbedderPolicy: false,
}));
console.log(`🛡  CSP ${cspEnforce ? 'ENFORCE' : 'REPORT-ONLY'} aktif`);

// Yanlış token brute-force'una karşı: dakikada 30 geçersiz-token isteği/IP.
// Yalnızca geçersiz token'lı istekler sayılır (skip). Eskiden skipSuccessfulRequests
// kullanılıyordu: istek önce sayılıp sonra düşüldüğünden 30+ eşzamanlı meşru istek
// ya da iş mantığı hataları (404/409) kullanıcıyı 429 ile kilitleyebiliyordu.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: hasValidToken,
  message: { ok: false, error: 'Çok fazla istek — biraz bekleyin' },
});

app.use(express.static(path.join(__dirname, 'public')));
// Gövde ayrıştırma auth'tan SONRA: yetkisiz istekler büyük JSON ayrıştırtamaz.
app.use('/api', authLimiter, requireToken, express.json({ limit: '50mb' }));

// ── Yardımcılar: giriş doğrulama ─────────────────────────────────────────
const BACKUP_NAME_RE = /^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;
const MAX_BACKUPS = 50;
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const DURUM_SET     = new Set(['Taslak', 'Onay Bekliyor', 'Onaylı', 'Reddedildi']);
const ACILIYET_SET  = new Set(['Normal', 'Acil', 'Çok Acil']);
const DATE_RE       = /^\d{4}-\d{2}-\d{2}$/;
// Tarih yardımcıları — toISOString() UTC üretir; TR (UTC+3) gece yarısı civarında
// bir önceki güne/aya kayardı. Yerel gün/ay bileşenlerinden üretiyoruz.
const pad2 = n => String(n).padStart(2, '0');
function localISODate(d = new Date()) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function localYM(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
// Hareketler.tarih: istemci ISO-UTC ('…Z') veya sade 'YYYY-MM-DD' yazabilir.
// Saatli kayıtlar sunucu saat dilimindeki yerel güne çevrilir. SQLite'ın
// 'localtime' değiştiricisi platforma/TZ'ye bağlı olduğundan, farkı Node'da
// hesaplayıp dakika olarak veriyoruz (tamsayıdan üretilir → SQL enjeksiyonu yok).
function localDaySql() {
  const off = -new Date().getTimezoneOffset(); // UTC'den ileri → pozitif
  const mod = (off >= 0 ? '+' : '-') + Math.abs(off) + ' minutes';
  return "(CASE WHEN length(tarih) > 10 THEN date(tarih,'" + mod + "') ELSE substr(tarih,1,10) END)";
}
function isStr(x, max = 500) { return typeof x === 'string' && x.length <= max; }
function isOptStr(x, max = 500) { return x == null || x === '' || isStr(x, max); }
function validateTalep(b) {
  if (!b || typeof b !== 'object') return 'Gövde yok';
  if (b.tarih && !DATE_RE.test(b.tarih)) return 'tarih formatı geçersiz';
  if (b.durum && !DURUM_SET.has(b.durum)) return 'durum geçersiz';
  if (b.aciliyet && !ACILIYET_SET.has(b.aciliyet)) return 'aciliyet geçersiz';
  for (const f of ['birim','personel','depo','gerekce','imza1','imza2','imza3']) {
    if (!isOptStr(b[f])) return f + ' geçersiz';
  }
  if (b.satirlar != null && !Array.isArray(b.satirlar)) return 'satirlar dizi olmalı';
  if (Array.isArray(b.satirlar) && b.satirlar.length > 500) return 'satirlar çok büyük';
  return null;
}
function validateHareket(b) {
  if (!b || typeof b !== 'object') return 'Gövde yok';
  const tarihStr = typeof b.tarih === 'string' ? b.tarih.slice(0, 10) : '';
  if (!DATE_RE.test(tarihStr)) return 'tarih formatı geçersiz';
  if (b.tur !== 'Giriş' && b.tur !== 'Çıkış') return 'tur geçersiz (Giriş veya Çıkış)';
  if (!isStr(b.depo, 200) || !b.depo.trim()) return 'depo geçersiz';
  if (!isStr(b.malzeme, 500) || !b.malzeme.trim()) return 'malzeme geçersiz';
  if (typeof b.miktar !== 'number' || !isFinite(b.miktar) || b.miktar <= 0 || b.miktar > 1e9) return 'miktar geçersiz (pozitif sayı)';
  for (const f of ['birim', 'not', 'skt', 'belge', 'personel']) {
    if (!isOptStr(b[f], 1000)) return f + ' geçersiz';
  }
  return null;
}

// Yedek rotasyonu — en yeni MAX_BACKUPS dışındakileri sil
function rotateBackups(backupDir) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => BACKUP_NAME_RE.test(f))
      .sort().reverse();
    files.slice(MAX_BACKUPS).forEach(f => {
      try { fs.unlinkSync(path.join(backupDir, f)); } catch(_) {}
    });
  } catch(_) {}
}

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);
// WAL: eş zamanlı okuma/yazma, daha hızlı commit.
// synchronous=NORMAL: WAL ile birlikte güvenli/hızlı denge.
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA synchronous = NORMAL');
db.run('PRAGMA foreign_keys = ON');

// ── Promise yardımcıları ───────────────────────────────────────────────────
const dbGet = (sql, p = []) => new Promise((res, rej) =>
  db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const dbAll = (sql, p = []) => new Promise((res, rej) =>
  db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const dbRun = (sql, p = []) => new Promise((res, rej) =>
  db.run(sql, p, function(e) { e ? rej(e) : res(this); }));
const dbPrepare = (sql) => new Promise((res, rej) => {
  const st = db.prepare(sql, e => e ? rej(e) : res(st));
});
const stmtRun = (st, p = []) => new Promise((res, rej) =>
  st.run(p, e => e ? rej(e) : res()));
const stmtFinalize = (st) => new Promise((res, rej) =>
  st.finalize(e => e ? rej(e) : res()));

// ── Transaction kuyruğu ───────────────────────────────────────────────────
// Tüm istekler TEK SQLite bağlantısını paylaşır. İki istek aynı anda BEGIN
// açarsa "cannot start a transaction within a transaction" hatası ya da bir
// isteğin ROLLBACK'inin diğerinin işlemini geri alması mümkündü. Bütün
// yazmalar bu kuyruktan geçer → aynı anda en fazla bir transaction açık.
let _txChain = Promise.resolve();
function withTransaction(fn) {
  const run = _txChain.then(async () => {
    await dbRun('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = await fn();
      await dbRun('COMMIT');
      return result;
    } catch (e) {
      try { await dbRun('ROLLBACK'); } catch { /* işlem zaten sonlanmış olabilir */ }
      throw e;
    }
  });
  _txChain = run.catch(() => {});
  return run;
}
// Tek ifadelik yazmalar da kuyruktan geçsin (başkasının açık transaction'ına karışmasın)
const dbWrite = (sql, p = []) => withTransaction(() => dbRun(sql, p));

class ConflictError extends Error {
  constructor(version) {
    super('Çakışma: veriler başka yerden değişti');
    this.version = version;
  }
}

// ── Hareket yardımcıları ──────────────────────────────────────────────────
const HAREKET_INSERT = `
  INSERT INTO Hareketler (tarih, tur, depo, malzeme, miktar, birim, not_, skt, belge, personel)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
function normalizeHareket(b) {
  return {
    tarih: b.tarih, tur: b.tur, depo: b.depo.trim(), malzeme: b.malzeme.trim(), miktar: b.miktar,
    birim: b.birim, not: b.not, skt: b.skt, belge: b.belge, personel: b.personel,
  };
}
const hareketParams = h => [
  h.tarih, h.tur, h.depo, h.malzeme, h.miktar,
  h.birim || null, h.not || null, h.skt || null, h.belge || null, h.personel || null,
];
// Mutlaka bir withTransaction içinden çağrılmalı
async function insertHareketler(rows) {
  if (!rows.length) return;
  const stmt = await dbPrepare(HAREKET_INSERT);
  try {
    for (const h of rows) await stmtRun(stmt, hareketParams(h));
  } finally {
    await stmtFinalize(stmt);
  }
}
// Yedekten geri yükleme: sadece NOT NULL kolonları ve türleri doğrula (sadık geri yükleme)
function restoreHareketGecerli(h) {
  return !!h && typeof h === 'object'
    && typeof h.tarih === 'string' && h.tarih
    && (h.tur === 'Giriş' || h.tur === 'Çıkış')
    && typeof h.depo === 'string' && h.depo
    && typeof h.malzeme === 'string' && h.malzeme
    && typeof h.miktar === 'number' && isFinite(h.miktar);
}


// ── Migration: AppState.hareketler → Hareketler tablosu ───────────────────
async function migrateHareketler() {
  try {
    const cnt = await dbGet('SELECT COUNT(*) as cnt FROM Hareketler');
    if (cnt && cnt.cnt > 0) return; // zaten migrate edilmiş
    const appRow = await dbGet('SELECT data FROM AppState WHERE id = 1');
    if (!appRow) return;
    let appData = {};
    try { appData = JSON.parse(appRow.data); } catch { return; }
    const hareketler = appData.hareketler;
    if (!Array.isArray(hareketler) || hareketler.length === 0) return;

    console.log(`\n📦 Migration: ${hareketler.length} hareket Hareketler tablosuna taşınıyor...`);
    await withTransaction(async () => {
      await insertHareketler(hareketler.map(h => ({
        tarih: h.tarih || new Date().toISOString(),
        tur: h.tur === 'Giriş' || h.tur === 'Çıkış' ? h.tur : 'Giriş',
        depo: h.depo || '',
        malzeme: h.malzeme || '',
        miktar: typeof h.miktar === 'number' ? h.miktar : 0,
        birim: h.birim, not: h.not, skt: h.skt, belge: h.belge, personel: h.personel,
      })));
      // AppState JSON'undan hareketler alanını kaldır
      const { hareketler: _dropped, ...newData } = appData;
      await dbRun('UPDATE AppState SET data = ? WHERE id = 1', [JSON.stringify(newData)]);
    });
    console.log(`✅ Migration tamamlandı: ${hareketler.length} hareket taşındı.\n`);
  } catch (e) {
    console.error('Migration hatası (geri alındı):', e.message);
  }
}



db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS AppState (
    id INTEGER PRIMARY KEY,
    data TEXT
  )`);
  db.get('SELECT id FROM AppState WHERE id = 1', (_err, row) => {
    if (!row) db.run(`INSERT INTO AppState (id, data) VALUES (1, '{}')`);
  });
  db.run(`ALTER TABLE AppState ADD COLUMN version INTEGER DEFAULT 0`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS Talepler (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    no        TEXT    NOT NULL,
    tarih     TEXT    NOT NULL,
    birim     TEXT,
    personel  TEXT,
    depo      TEXT,
    aciliyet  TEXT,
    gerekce   TEXT,
    satirlar  TEXT,
    imza1     TEXT,
    imza2     TEXT,
    imza3     TEXT,
    durum     TEXT DEFAULT 'Taslak',
    olusturma TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_talepler_no    ON Talepler(no)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_talepler_durum ON Talepler(durum)`);

  // ── ROADMAP #5: Hareketler tablosu ────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS Hareketler (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tarih     TEXT    NOT NULL,
    tur       TEXT    NOT NULL,
    depo      TEXT    NOT NULL,
    malzeme   TEXT    NOT NULL,
    miktar    REAL    NOT NULL,
    birim     TEXT,
    not_      TEXT,
    skt       TEXT,
    belge     TEXT,
    personel  TEXT,
    olusturma TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_har_tarih    ON Hareketler(tarih)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_har_depo_mal ON Hareketler(depo, malzeme)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_har_skt      ON Hareketler(skt)`);

  // Migration mevcut veriler varsa çalıştır
  setTimeout(migrateHareketler, 500);
});

// ── ANA VERİ (load / save / reset / backup) ──────────────────────────────────
app.get('/api', async (req, res) => {
  const action = req.query.action;

  if (action === 'load') {
    db.get('SELECT data, version FROM AppState WHERE id = 1', (err, row) => {
      if (err) return res.json({ ok: false, error: err.message });
      // Row silinmişse boş state ile dön — bir sonraki save UPSERT yapacak
      if (!row) return res.json({ ok: true, data: {}, version: 0, yeni: true });
      try {
        const data = JSON.parse(row.data);
        res.json({ ok: true, data, version: row.version || 0, yeni: Object.keys(data).length === 0 });
      } catch (e) {
        res.json({ ok: false, error: 'JSON parse error' });
      }
    });

  } else if (action === 'backup_list') {
    const backupDir = BACKUP_DIR;
    if (!fs.existsSync(backupDir)) { res.json({ ok: true, yedekler: [] }); return; }
    try {
      const files = fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.json'))
        .sort().reverse()
        .map(f => {
          const stat = fs.statSync(path.join(backupDir, f));
          const kb = (stat.size / 1024).toFixed(1) + ' KB';
          return { dosya: f, boyut: kb, tarih: f.replace('backup_','').replace('.json','').replace('T',' ').replace(/-/g,':').slice(0,16) };
        });
      res.json({ ok: true, yedekler: files });
    } catch(e) { res.json({ ok: false, error: e.message }); }

  } else if (action === 'talep_list') {
    db.all('SELECT * FROM Talepler ORDER BY id DESC', (err, rows) => {
      if (err) return res.json({ ok: false, error: err.message });
      const talepler = rows.map(r => ({
        ...r,
        satirlar: (() => { try { return JSON.parse(r.satirlar || '[]'); } catch { return []; } })(),
      }));
      res.json({ ok: true, talepler });
    });

  } else if (action === 'talep_no') {
    db.get('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM Talepler', (err, row) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true, no: 'TLN-' + String(row.next).padStart(4, '0') });
    });

  } else if (action === 'istatistik') {
    try {
      // Stok — toplamStokKalem için AppState'den
      const appRow = await dbGet('SELECT data FROM AppState WHERE id = 1');
      let stok = {};
      try { stok = JSON.parse(appRow.data).stok || {}; } catch(e) {}

      // Son 6 ay trend — SQL ile
      const now = new Date();
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const trendRows = await dbAll(`
        SELECT substr(${localDaySql()}, 1, 7) as ym,
               SUM(CASE WHEN tur='Giriş' THEN miktar ELSE 0 END) as giris,
               SUM(CASE WHEN tur='Çıkış' THEN miktar ELSE 0 END) as cikis
        FROM Hareketler
        WHERE ${localDaySql()} >= ?
        GROUP BY ym ORDER BY ym ASC
      `, [localISODate(sixMonthsAgo)]);

      const ymMap = {};
      trendRows.forEach(r => { ymMap[r.ym] = r; });
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = localYM(d);
        const label = d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' });
        trend.push({
          label,
          giris: Number(ymMap[ym]?.giris || 0),
          cikis: Number(ymMap[ym]?.cikis || 0),
        });
      }

      // En aktif 5 malzeme
      const enAktif = await dbAll(`
        SELECT malzeme as ad, COUNT(*) as cnt FROM Hareketler
        GROUP BY malzeme ORDER BY cnt DESC LIMIT 5
      `);

      // Özet sayılar
      const gunOnce = n => localISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
      const bugunISO = gunOnce(0);
      const dunISO   = gunOnce(1);
      const ozetRow = await dbGet(`
        SELECT
          COUNT(*) as toplamHareket,
          SUM(CASE WHEN ${localDaySql()} = ? AND tur='Giriş' THEN 1 ELSE 0 END) as bugunGiris,
          SUM(CASE WHEN ${localDaySql()} = ? AND tur='Çıkış' THEN 1 ELSE 0 END) as bugunCikis,
          SUM(CASE WHEN ${localDaySql()} = ?               THEN 1 ELSE 0 END) as dunHareket
        FROM Hareketler
      `, [bugunISO, bugunISO, dunISO]);

      // 7 günlük sparkline
      const sparkRows = await dbAll(`
        SELECT ${localDaySql()} as gun, COUNT(*) as cnt FROM Hareketler
        WHERE ${localDaySql()} >= ?
        GROUP BY gun ORDER BY gun ASC
      `, [gunOnce(6)]);
      const sparkMap = {};
      sparkRows.forEach(r => { sparkMap[r.gun] = r.cnt; });
      const sparkline = [];
      for (let i = 6; i >= 0; i--) {
        const ds = gunOnce(i);
        sparkline.push(sparkMap[ds] || 0);
      }

      // Son 8 hareket (dashboard kartı için)
      const sonHareketler = await dbAll(`
        SELECT id, tarih, tur, depo, malzeme, miktar, birim,
               not_ as "not", skt, belge, personel
        FROM Hareketler ORDER BY id DESC LIMIT 8
      `);

      const toplamStokKalem = Object.values(stok).reduce((a, d) => a + Object.keys(d).length, 0);

      res.json({
        ok: true,
        trend,
        enAktif,
        ozet: {
          toplamHareket : ozetRow.toplamHareket || 0,
          bugunGiris    : ozetRow.bugunGiris    || 0,
          bugunCikis    : ozetRow.bugunCikis    || 0,
          dunHareket    : ozetRow.dunHareket    || 0,
          toplamStokKalem,
        },
        sparkline,
        sonHareketler,
      });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'hareket_list') {
    try {
      const offset  = Math.max(0, parseInt(req.query.offset)  || 0);
      // Dışa aktarma tüm kayıtları isteyebilir; üst sınır yalnızca kötüye kullanıma karşı.
      const limit   = Math.min(1000000, Math.max(1, parseInt(req.query.limit) || 50));
      const depo    = req.query.depo    || '';
      const malzeme = req.query.malzeme || '';
      const tur     = req.query.tur     || '';
      const tarihMin = req.query.tarih_min || '';
      const tarihMax = req.query.tarih_max || '';
      const personel = req.query.personel || '';
      const q       = req.query.q        || '';

      const where = [];
      const params = [];
      // LIKE wildcard escape helper
      const escLike = s => '%' + String(s).replace(/[\\%_]/g, ch => '\\' + ch) + '%';
      if (depo)     { where.push('depo = ?');    params.push(depo); }
      if (malzeme)  { where.push('malzeme = ?'); params.push(malzeme); }
      if (tur && (tur === 'Giriş' || tur === 'Çıkış')) { where.push('tur = ?'); params.push(tur); }
      if (tarihMin) { where.push(localDaySql() + " >= ?"); params.push(tarihMin); }
      if (tarihMax) { where.push(localDaySql() + " <= ?"); params.push(tarihMax); }
      if (personel) {
        where.push("personel LIKE ? ESCAPE '\\'");
        params.push(escLike(personel));
      }
      if (q) {
        // LIKE wildcard'larını escape et — kullanıcı literal '%' ya da '_' arayabilsin
        const like = escLike(q);
        where.push("(malzeme LIKE ? ESCAPE '\\' OR depo LIKE ? ESCAPE '\\' OR personel LIKE ? ESCAPE '\\' OR belge LIKE ? ESCAPE '\\')");
        params.push(like, like, like, like);
      }

      const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

      const countRow = await dbGet(
        `SELECT COUNT(*) as cnt FROM Hareketler ${whereSQL}`, params);

      // Bugünün istatistikleri (filtre olmadan)
      const bugunISO = localISODate();
      const ozetRow = await dbGet(`
        SELECT
          COUNT(*) as toplamHareket,
          SUM(CASE WHEN ${localDaySql()} = ? AND tur='Giriş' THEN 1 ELSE 0 END) as bugunGiris,
          SUM(CASE WHEN ${localDaySql()} = ? AND tur='Çıkış' THEN 1 ELSE 0 END) as bugunCikis
        FROM Hareketler
      `, [bugunISO, bugunISO]);

      const enAktifRow = await dbGet(`
        SELECT malzeme FROM Hareketler GROUP BY malzeme ORDER BY COUNT(*) DESC LIMIT 1
      `);

      const hareketler = await dbAll(`
        SELECT id, tarih, tur, depo, malzeme, miktar, birim,
               not_ as "not", skt, belge, personel, olusturma
        FROM Hareketler ${whereSQL}
        ORDER BY id DESC LIMIT ? OFFSET ?
      `, [...params, limit, offset]);

      res.json({
        ok: true,
        hareketler,
        toplam: countRow.cnt || 0,
        ozet: {
          toplamHareket : ozetRow.toplamHareket || 0,
          bugunGiris    : ozetRow.bugunGiris    || 0,
          bugunCikis    : ozetRow.bugunCikis    || 0,
          enAktifMalzeme: enAktifRow?.malzeme || null,
        },
      });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else {
    res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  }
});

app.post('/api', async (req, res) => {
  const action = req.query.action;

  if (action === 'save') {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz gövde' });
    }
    if (b.stok == null || typeof b.stok !== 'object' || Array.isArray(b.stok)) {
      return res.status(400).json({ ok: false, error: 'stok nesne olmalı' });
    }
    for (const f of ['ozelMalzeme', 'silinmis', 'malzemeMeta']) {
      if (b[f] != null && (typeof b[f] !== 'object' || Array.isArray(b[f]))) {
        return res.status(400).json({ ok: false, error: f + ' nesne olmalı' });
      }
    }
    const clientVersion = (typeof b._version === 'number') ? b._version : null;
    // hareketler artık ayrı tabloda — payload'dan çıkar
    const { _version, hareketler: _h, ...saveData } = b;
    const payload = JSON.stringify(saveData);

    try {
      const version = await withTransaction(async () => {
        const row = await dbGet('SELECT version FROM AppState WHERE id = 1');
        const serverVersion = row ? (row.version || 0) : 0;
        if (clientVersion !== null && clientVersion !== serverVersion) {
          throw new ConflictError(serverVersion);
        }
        const newVersion = serverVersion + 1;
        // UPSERT — id=1 row'u silinmiş olsa bile yazımı garanti et
        await dbRun(
          `INSERT INTO AppState (id, data, version) VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data, version = excluded.version`,
          [payload, newVersion]
        );
        return newVersion;
      });
      res.json({ ok: true, version });
    } catch (e) {
      if (e instanceof ConflictError) {
        return res.status(409).json({ ok: false, error: e.message, version: e.version });
      }
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'reset') {
    try {
      await withTransaction(async () => {
        await dbRun(`UPDATE AppState SET data = '{}', version = 0 WHERE id = 1`);
        await dbRun('DELETE FROM Hareketler');
        await dbRun('DELETE FROM Talepler');
        // AUTOINCREMENT sayaçlarını da sıfırla — yeni TLN-0001'den başlasın
        await dbRun("DELETE FROM sqlite_sequence WHERE name IN ('Hareketler','Talepler')");
      });
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'hareket_ekle') {
    const b = req.body;
    const err0 = validateHareket(b);
    if (err0) return res.status(400).json({ ok: false, error: err0 });

    try {
      const result = await dbWrite(HAREKET_INSERT, hareketParams(normalizeHareket(b)));
      res.json({ ok: true, id: result.lastID });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'hareket_sil') {
    const b = req.body || {};
    if (!Number.isInteger(b.id) || b.id <= 0) {
      return res.status(400).json({ ok: false, error: 'id geçersiz' });
    }
    try {
      const r = await dbWrite('DELETE FROM Hareketler WHERE id = ?', [b.id]);
      // Zaten silinmişse (başka sekme) hata dön: istemci stoğu ikinci kez düzeltmesin
      if (r.changes === 0) {
        return res.status(404).json({ ok: false, error: 'Hareket bulunamadı (zaten silinmiş olabilir)' });
      }
      res.json({ ok: true });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'hareket_depo_guncelle') {
    const b = req.body || {};
    if (!isStr(b.eskiDepo, 200) || !isStr(b.yeniDepo, 200)) {
      return res.status(400).json({ ok: false, error: 'eskiDepo/yeniDepo geçersiz' });
    }
    try {
      await dbWrite('UPDATE Hareketler SET depo = ? WHERE depo = ?', [b.yeniDepo, b.eskiDepo]);
      res.json({ ok: true });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'hareket_malzeme_guncelle') {
    const b = req.body || {};
    if (!isStr(b.depo, 200) || !isStr(b.eskiMalzeme, 500) || !isStr(b.yeniMalzeme, 500)) {
      return res.status(400).json({ ok: false, error: 'depo/eskiMalzeme/yeniMalzeme geçersiz' });
    }
    try {
      await dbWrite('UPDATE Hareketler SET malzeme = ? WHERE depo = ? AND malzeme = ?',
        [b.yeniMalzeme, b.depo, b.eskiMalzeme]);
      res.json({ ok: true });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'hareket_toplu_ekle') {
    const b = req.body || {};
    if (!Array.isArray(b.hareketler)) {
      return res.status(400).json({ ok: false, error: 'hareketler dizi olmalı' });
    }
    if (b.hareketler.length > 100000) {
      return res.status(400).json({ ok: false, error: 'çok fazla kayıt (max 100000)' });
    }
    // Tek tek doğrula: geçersiz satır sessizce "düzeltilmez", atlanır ve raporlanır.
    const gecerli = [];
    const atlanan = [];
    b.hareketler.forEach((h, i) => {
      const e = validateHareket(h);
      if (e) atlanan.push({ index: i, sebep: e });
      else gecerli.push(normalizeHareket(h));
    });
    // degistir: dışa aktarılan tam yedeği geri yüklerken kayıtlar tekrarlanmasın
    const degistir = b.degistir === true;
    if (degistir && !gecerli.length) {
      return res.status(400).json({ ok: false, error: 'Geçerli hareket yok — mevcut kayıtlar silinmedi' });
    }
    try {
      await withTransaction(async () => {
        if (degistir) await dbRun('DELETE FROM Hareketler');
        await insertHareketler(gecerli);
      });
      res.json({ ok: true, eklenen: gecerli.length, atlanan: atlanan.length, detay: atlanan.slice(0, 20) });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'talep_kaydet') {
    const b = req.body || {};
    const err0 = validateTalep(b);
    if (err0) return res.status(400).json({ ok: false, error: err0 });
    if (!b.tarih) return res.status(400).json({ ok: false, error: 'tarih zorunlu' });

    try {
      const sonuc = await withTransaction(async () => {
        const row = await dbGet('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM Talepler');
        const no = 'TLN-' + String(row.next).padStart(4, '0');
        const r = await dbRun(
          `INSERT INTO Talepler (no, tarih, birim, personel, depo, aciliyet, gerekce, satirlar, imza1, imza2, imza3, durum)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [no, b.tarih, b.birim ?? null, b.personel ?? null, b.depo ?? null, b.aciliyet ?? null, b.gerekce ?? null,
           JSON.stringify(b.satirlar || []), b.imza1 ?? null, b.imza2 ?? null, b.imza3 ?? null, b.durum || 'Taslak']
        );
        return { id: r.lastID, no };
      });
      res.json({ ok: true, ...sonuc });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'talep_guncelle') {
    const b = req.body || {};
    const err0 = validateTalep(b);
    if (err0) return res.status(400).json({ ok: false, error: err0 });
    if (!Number.isInteger(b.id) || b.id <= 0) return res.status(400).json({ ok: false, error: 'id geçersiz' });
    try {
      const r = await dbWrite(
        `UPDATE Talepler SET birim=?, personel=?, depo=?, aciliyet=?, gerekce=?,
         satirlar=?, imza1=?, imza2=?, imza3=?, durum=? WHERE id=?`,
        [b.birim ?? null, b.personel ?? null, b.depo ?? null, b.aciliyet ?? null, b.gerekce ?? null,
         JSON.stringify(b.satirlar || []), b.imza1 ?? null, b.imza2 ?? null, b.imza3 ?? null, b.durum, b.id]
      );
      if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Talep bulunamadı' });
      res.json({ ok: true });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'talep_durum') {
    const b = req.body || {};
    if (!Number.isInteger(b.id) || b.id <= 0) return res.status(400).json({ ok: false, error: 'id geçersiz' });
    if (!DURUM_SET.has(b.durum))               return res.status(400).json({ ok: false, error: 'durum geçersiz' });
    try {
      const r = await dbWrite('UPDATE Talepler SET durum=? WHERE id=?', [b.durum, b.id]);
      if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Talep bulunamadı' });
      res.json({ ok: true });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'backup_olustur') {
    try {
      // Üç tablo tek transaction içinde okunur → tutarlı anlık görüntü
      const backupPayload = await withTransaction(async () => {
        const appRow = await dbGet('SELECT data FROM AppState WHERE id = 1');
        let appData = {};
        try { appData = JSON.parse(appRow.data); } catch { /* bozuk JSON → boş state */ }

        const hareketlerRows = await dbAll(`
          SELECT id, tarih, tur, depo, malzeme, miktar, birim,
                 not_ as "not", skt, belge, personel, olusturma
          FROM Hareketler ORDER BY id ASC
        `);

        // satirlar JSON string olarak SQLite'ta tutuluyor
        const taleplerRows = await dbAll(`
          SELECT id, no, tarih, birim, personel, depo, aciliyet, gerekce,
                 satirlar, imza1, imza2, imza3, durum, olusturma
          FROM Talepler ORDER BY id ASC
        `);
        return { ...appData, _hareketler: hareketlerRows, _talepler: taleplerRows };
      });
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const ts = new Date().toISOString().slice(0,19).replace(/:/g,'-');
      const fname = `backup_${ts}.json`;
      // Önce geçici dosyaya yaz, sonra rename (atomik) → yarım/bozuk yedek kalmaz
      const finalPath = path.join(BACKUP_DIR, fname);
      const tmpPath = finalPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(backupPayload), 'utf8');
      fs.renameSync(tmpPath, finalPath);
      rotateBackups(BACKUP_DIR);
      res.json({ ok: true, dosya: fname });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'backup_yukle') {
    const { dosya } = req.body || {};
    if (!isStr(dosya, 80) || !BACKUP_NAME_RE.test(dosya)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz yedek adı' });
    }
    const fpath = path.join(BACKUP_DIR, dosya);
    if (!fs.existsSync(fpath)) return res.json({ ok: false, error: 'Dosya bulunamadı' });
    try {
      const parsed = JSON.parse(fs.readFileSync(fpath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return res.json({ ok: false, error: 'Yedek dosyası geçersiz' });
      }

      // _hareketler ve _talepler ayrı tablolara, geri kalanı AppState'e
      const { _hareketler, _talepler, hareketler: _legacy, ...appData } = parsed;
      const hamHareket = Array.isArray(_hareketler) ? _hareketler : (Array.isArray(_legacy) ? _legacy : []);
      const hamTalep   = Array.isArray(_talepler) ? _talepler : [];

      // Bozuk satır tüm geri yüklemeyi düşürmesin: atla ve raporla
      const hareketler = hamHareket.filter(restoreHareketGecerli);
      const talepler   = hamTalep.filter(t =>
        t && typeof t === 'object' && isStr(t.no, 100) && t.no && isStr(t.tarih, 100) && t.tarih);

      await withTransaction(async () => {
        await dbRun('UPDATE AppState SET data = ?, version = 0 WHERE id = 1', [JSON.stringify(appData)]);
        await dbRun('DELETE FROM Hareketler');
        await dbRun('DELETE FROM Talepler');
        await insertHareketler(hareketler);

        if (talepler.length) {
          const stmt = await dbPrepare(`
            INSERT INTO Talepler (no, tarih, birim, personel, depo, aciliyet,
                                  gerekce, satirlar, imza1, imza2, imza3, durum, olusturma)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          try {
            for (const t of talepler) {
              // satirlar yedekte string (DB sütun değeri) veya array (eski yedek) olabilir
              const satirlar = typeof t.satirlar === 'string' ? t.satirlar : JSON.stringify(t.satirlar || []);
              await stmtRun(stmt, [
                t.no, t.tarih, t.birim || null, t.personel || null,
                t.depo || null, t.aciliyet || null, t.gerekce || null,
                satirlar, t.imza1 || null, t.imza2 || null, t.imza3 || null,
                t.durum || 'Taslak', t.olusturma || null,
              ]);
            }
          } finally {
            await stmtFinalize(stmt);
          }
        }
      });
      res.json({
        ok: true,
        atlanan: { hareket: hamHareket.length - hareketler.length, talep: hamTalep.length - talepler.length },
      });
    } catch(e) { res.json({ ok: false, error: e.message }); }

  } else {
    res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  }
});

// Beklenmeyen hatalar (geçersiz JSON, aşırı büyük gövde…) HTML/stack yerine JSON dönsün
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('İstek hatası:', err);
  const error = status === 413 ? 'İstek çok büyük' : status < 500 ? 'Geçersiz istek' : 'Sunucu hatası';
  res.status(status).json({ ok: false, error });
});

const server = app.listen(PORT, () => {
  console.log(`Depo Takip sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});

// ── Graceful shutdown — WAL checkpoint kaçırılmasın ────────────────────
function shutdown(signal) {
  console.log(`\n${signal} alındı — kapatılıyor...`);
  server.close(() => {
    db.run('PRAGMA wal_checkpoint(TRUNCATE)', () => {
      db.close(err => {
        if (err) console.error('DB close hatası:', err.message);
        else console.log('DB temiz kapatıldı.');
        process.exit(0);
      });
    });
  });
  setTimeout(() => { console.error('Zorla kapatma'); process.exit(1); }, 5000).unref();
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
