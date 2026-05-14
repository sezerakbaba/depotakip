const express = require('express');
const crypto  = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const APP_TOKEN = process.env.APP_TOKEN || (() => {
  const t = crypto.randomBytes(24).toString('hex');
  console.log('\n⚠  APP_TOKEN ayarlanmamış — bu oturum için rastgele token:');
  console.log('   ' + t);
  console.log('   Kalıcı yapmak için: APP_TOKEN=' + t + ' node server.js\n');
  return t;
})();

function requireToken(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== APP_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Yetkisiz erişim' });
  }
  next();
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', requireToken);

// ── Yardımcılar: giriş doğrulama ─────────────────────────────────────────
const BACKUP_NAME_RE = /^backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;
const MAX_BACKUPS = 50;
const DURUM_SET     = new Set(['Taslak', 'Onay Bekliyor', 'Onaylı', 'Reddedildi']);
const ACILIYET_SET  = new Set(['Normal', 'Acil', 'Çok Acil']);
const DATE_RE       = /^\d{4}-\d{2}-\d{2}$/;
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

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// ── Promise yardımcıları ───────────────────────────────────────────────────
const dbGet = (sql, p = []) => new Promise((res, rej) =>
  db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const dbAll = (sql, p = []) => new Promise((res, rej) =>
  db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const dbRun = (sql, p = []) => new Promise((res, rej) =>
  db.run(sql, p, function(e) { e ? rej(e) : res(this); }));

// ── Migration: AppState.hareketler → Hareketler tablosu ───────────────────
function migrateHareketler() {
  db.get('SELECT COUNT(*) as cnt FROM Hareketler', (err, row) => {
    if (err) return;
    if (row && row.cnt > 0) return; // zaten migrate edilmiş
    db.get('SELECT data FROM AppState WHERE id = 1', (err2, appRow) => {
      if (err2 || !appRow) return;
      let appData = {};
      try { appData = JSON.parse(appRow.data); } catch(e) { return; }
      const hareketler = appData.hareketler;
      if (!Array.isArray(hareketler) || hareketler.length === 0) return;

      console.log(`\n📦 Migration: ${hareketler.length} hareket Hareketler tablosuna taşınıyor...`);
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare(`
          INSERT INTO Hareketler (tarih, tur, depo, malzeme, miktar, birim, not_, skt, belge, personel)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        hareketler.forEach(h => {
          stmt.run([
            h.tarih || new Date().toISOString(),
            h.tur === 'Giriş' || h.tur === 'Çıkış' ? h.tur : 'Giriş',
            h.depo || '',
            h.malzeme || '',
            typeof h.miktar === 'number' ? h.miktar : 0,
            h.birim || null,
            h.not  || null,
            h.skt  || null,
            h.belge || null,
            h.personel || null,
          ]);
        });
        stmt.finalize();
        // AppState JSON'undan hareketler alanını kaldır
        const { hareketler: _dropped, ...newData } = appData;
        db.run('UPDATE AppState SET data = ? WHERE id = 1', [JSON.stringify(newData)], err3 => {
          if (err3) {
            db.run('ROLLBACK');
            console.error('Migration rollback:', err3.message);
            return;
          }
          db.run('COMMIT', err4 => {
            if (err4) console.error('Migration commit hatası:', err4.message);
            else console.log(`✅ Migration tamamlandı: ${hareketler.length} hareket taşındı.\n`);
          });
        });
      });
    });
  });
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

  // Migration mevcut veriler varsa çalıştır
  setTimeout(migrateHareketler, 500);
});

// ── ANA VERİ (load / save / reset / backup) ──────────────────────────────────
app.get('/api/api.php', async (req, res) => {
  const action = req.query.action;

  if (action === 'load') {
    db.get('SELECT data, version FROM AppState WHERE id = 1', (err, row) => {
      if (err) return res.json({ ok: false, error: err.message });
      try {
        const data = JSON.parse(row.data);
        res.json({ ok: true, data, version: row.version || 0, yeni: Object.keys(data).length === 0 });
      } catch (e) {
        res.json({ ok: false, error: 'JSON parse error' });
      }
    });

  } else if (action === 'backup_list') {
    const backupDir = path.join(__dirname, 'backups');
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
        satirlar: JSON.parse(r.satirlar || '[]'),
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
        SELECT strftime('%Y-%m', tarih) as ym,
               SUM(CASE WHEN tur='Giriş' THEN miktar ELSE 0 END) as giris,
               SUM(CASE WHEN tur='Çıkış' THEN miktar ELSE 0 END) as cikis
        FROM Hareketler
        WHERE tarih >= ?
        GROUP BY ym ORDER BY ym ASC
      `, [sixMonthsAgo.toISOString()]);

      const ymMap = {};
      trendRows.forEach(r => { ymMap[r.ym] = r; });
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = d.toISOString().slice(0, 7);
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
      const bugunISO = new Date().toISOString().slice(0, 10);
      const dunISO   = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const ozetRow = await dbGet(`
        SELECT
          COUNT(*) as toplamHareket,
          SUM(CASE WHEN substr(tarih,1,10) = ? AND tur='Giriş' THEN 1 ELSE 0 END) as bugunGiris,
          SUM(CASE WHEN substr(tarih,1,10) = ? AND tur='Çıkış' THEN 1 ELSE 0 END) as bugunCikis,
          SUM(CASE WHEN substr(tarih,1,10) = ?               THEN 1 ELSE 0 END) as dunHareket
        FROM Hareketler
      `, [bugunISO, bugunISO, dunISO]);

      // 7 günlük sparkline
      const sparkRows = await dbAll(`
        SELECT substr(tarih,1,10) as gun, COUNT(*) as cnt FROM Hareketler
        WHERE substr(tarih,1,10) >= ?
        GROUP BY gun ORDER BY gun ASC
      `, [new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)]);
      const sparkMap = {};
      sparkRows.forEach(r => { sparkMap[r.gun] = r.cnt; });
      const sparkline = [];
      for (let i = 6; i >= 0; i--) {
        const ds = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
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
      const limit   = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
      const depo    = req.query.depo    || '';
      const malzeme = req.query.malzeme || '';
      const tur     = req.query.tur     || '';
      const tarihMin = req.query.tarih_min || '';
      const tarihMax = req.query.tarih_max || '';
      const q       = req.query.q        || '';

      const where = [];
      const params = [];
      if (depo)     { where.push('depo = ?');    params.push(depo); }
      if (malzeme)  { where.push('malzeme = ?'); params.push(malzeme); }
      if (tur && (tur === 'Giriş' || tur === 'Çıkış')) { where.push('tur = ?'); params.push(tur); }
      if (tarihMin) { where.push("substr(tarih,1,10) >= ?"); params.push(tarihMin); }
      if (tarihMax) { where.push("substr(tarih,1,10) <= ?"); params.push(tarihMax); }
      if (q) {
        const like = '%' + q.replace(/%/g,'').replace(/_/g,'') + '%';
        where.push('(malzeme LIKE ? OR depo LIKE ? OR personel LIKE ? OR belge LIKE ?)');
        params.push(like, like, like, like);
      }

      const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

      const countRow = await dbGet(
        `SELECT COUNT(*) as cnt FROM Hareketler ${whereSQL}`, params);

      // Bugünün istatistikleri (filtre olmadan)
      const bugunISO = new Date().toISOString().slice(0, 10);
      const ozetRow = await dbGet(`
        SELECT
          COUNT(*) as toplamHareket,
          SUM(CASE WHEN substr(tarih,1,10) = ? AND tur='Giriş' THEN 1 ELSE 0 END) as bugunGiris,
          SUM(CASE WHEN substr(tarih,1,10) = ? AND tur='Çıkış' THEN 1 ELSE 0 END) as bugunCikis
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

app.post('/api/api.php', async (req, res) => {
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

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION');
      db.get('SELECT version FROM AppState WHERE id = 1', (err, row) => {
        if (err) { db.run('ROLLBACK'); return res.json({ ok: false, error: err.message }); }
        const serverVersion = row.version || 0;
        if (clientVersion !== null && clientVersion !== serverVersion) {
          db.run('ROLLBACK');
          return res.status(409).json({ ok: false, error: 'Çakışma: veriler başka yerden değişti', version: serverVersion });
        }
        const newVersion = serverVersion + 1;
        db.run('UPDATE AppState SET data = ?, version = ? WHERE id = 1', [payload, newVersion], err2 => {
          if (err2) { db.run('ROLLBACK'); return res.json({ ok: false, error: err2.message }); }
          db.run('COMMIT', err3 => {
            if (err3) return res.json({ ok: false, error: err3.message });
            res.json({ ok: true, version: newVersion });
          });
        });
      });
    });

  } else if (action === 'reset') {
    db.run('BEGIN IMMEDIATE TRANSACTION');
    db.run('UPDATE AppState SET data = "{}", version = 0 WHERE id = 1', err => {
      if (err) { db.run('ROLLBACK'); return res.json({ ok: false, error: err.message }); }
      db.run('DELETE FROM Hareketler', err2 => {
        if (err2) { db.run('ROLLBACK'); return res.json({ ok: false, error: err2.message }); }
        db.run('COMMIT', err3 => {
          if (err3) return res.json({ ok: false, error: err3.message });
          res.json({ ok: true });
        });
      });
    });

  } else if (action === 'hareket_ekle') {
    const b = req.body;
    const err0 = validateHareket(b);
    if (err0) return res.status(400).json({ ok: false, error: err0 });

    try {
      const result = await dbRun(`
        INSERT INTO Hareketler (tarih, tur, depo, malzeme, miktar, birim, not_, skt, belge, personel)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        b.tarih,
        b.tur,
        b.depo.trim(),
        b.malzeme.trim(),
        b.miktar,
        b.birim   || null,
        b.not     || null,
        b.skt     || null,
        b.belge   || null,
        b.personel|| null,
      ]);
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
      await dbRun('DELETE FROM Hareketler WHERE id = ?', [b.id]);
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
      await dbRun('UPDATE Hareketler SET depo = ? WHERE depo = ?', [b.yeniDepo, b.eskiDepo]);
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
      await dbRun('UPDATE Hareketler SET malzeme = ? WHERE depo = ? AND malzeme = ?',
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
    try {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare(`
          INSERT INTO Hareketler (tarih, tur, depo, malzeme, miktar, birim, not_, skt, belge, personel)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        b.hareketler.forEach(h => {
          if (!h.tarih || !h.malzeme || !h.depo) return;
          stmt.run([
            h.tarih, h.tur === 'Giriş' || h.tur === 'Çıkış' ? h.tur : 'Giriş',
            h.depo, h.malzeme,
            typeof h.miktar === 'number' ? h.miktar : 0,
            h.birim || null, h.not || null, h.skt || null,
            h.belge || null, h.personel || null,
          ]);
        });
        stmt.finalize(err => {
          if (err) { db.run('ROLLBACK'); return res.json({ ok: false, error: err.message }); }
          db.run('COMMIT', err2 => {
            if (err2) return res.json({ ok: false, error: err2.message });
            res.json({ ok: true, eklenen: b.hareketler.length });
          });
        });
      });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'talep_kaydet') {
    const b = req.body || {};
    const err0 = validateTalep(b);
    if (err0) return res.status(400).json({ ok: false, error: err0 });
    if (!b.tarih) return res.status(400).json({ ok: false, error: 'tarih zorunlu' });

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION');
      db.get('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM Talepler', (err, row) => {
        if (err) { db.run('ROLLBACK'); return res.json({ ok: false, error: err.message }); }
        const nextId = row.next;
        const no = 'TLN-' + String(nextId).padStart(4, '0');
        db.run(
          `INSERT INTO Talepler (no, tarih, birim, personel, depo, aciliyet, gerekce, satirlar, imza1, imza2, imza3, durum)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [no, b.tarih, b.birim, b.personel, b.depo, b.aciliyet, b.gerekce,
           JSON.stringify(b.satirlar || []), b.imza1, b.imza2, b.imza3, b.durum || 'Taslak'],
          function(err2) {
            if (err2) { db.run('ROLLBACK'); return res.json({ ok: false, error: err2.message }); }
            const insertedId = this.lastID;
            db.run('COMMIT', err3 => {
              if (err3) return res.json({ ok: false, error: err3.message });
              res.json({ ok: true, id: insertedId, no });
            });
          }
        );
      });
    });

  } else if (action === 'talep_guncelle') {
    const b = req.body || {};
    const err0 = validateTalep(b);
    if (err0) return res.status(400).json({ ok: false, error: err0 });
    if (!Number.isInteger(b.id) || b.id <= 0) return res.status(400).json({ ok: false, error: 'id geçersiz' });
    db.run(
      `UPDATE Talepler SET birim=?, personel=?, depo=?, aciliyet=?, gerekce=?,
       satirlar=?, imza1=?, imza2=?, imza3=?, durum=? WHERE id=?`,
      [b.birim, b.personel, b.depo, b.aciliyet, b.gerekce,
       JSON.stringify(b.satirlar || []), b.imza1, b.imza2, b.imza3, b.durum, b.id],
      err => {
        if (err) return res.json({ ok: false, error: err.message });
        res.json({ ok: true });
      }
    );

  } else if (action === 'talep_durum') {
    const b = req.body || {};
    if (!Number.isInteger(b.id) || b.id <= 0) return res.status(400).json({ ok: false, error: 'id geçersiz' });
    if (!DURUM_SET.has(b.durum))               return res.status(400).json({ ok: false, error: 'durum geçersiz' });
    db.run('UPDATE Talepler SET durum=? WHERE id=?', [b.durum, b.id], err => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true });
    });

  } else if (action === 'backup_olustur') {
    try {
      const appRow = await dbGet('SELECT data FROM AppState WHERE id = 1');
      let appData = {};
      try { appData = JSON.parse(appRow.data); } catch(e) {}

      // Tüm hareketleri ekle
      const hareketlerRows = await dbAll(`
        SELECT id, tarih, tur, depo, malzeme, miktar, birim,
               not_ as "not", skt, belge, personel, olusturma
        FROM Hareketler ORDER BY id ASC
      `);

      const backupPayload = { ...appData, _hareketler: hareketlerRows };
      const backupDir = path.join(__dirname, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
      const ts = new Date().toISOString().slice(0,19).replace(/:/g,'-');
      const fname = `backup_${ts}.json`;
      fs.writeFileSync(path.join(backupDir, fname), JSON.stringify(backupPayload), 'utf8');
      rotateBackups(backupDir);
      res.json({ ok: true, dosya: fname });
    } catch(e) {
      res.json({ ok: false, error: e.message });
    }

  } else if (action === 'backup_yukle') {
    const { dosya } = req.body || {};
    if (!isStr(dosya, 80) || !BACKUP_NAME_RE.test(dosya)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz yedek adı' });
    }
    const backupDir = path.join(__dirname, 'backups');
    const fpath = path.join(backupDir, dosya);
    if (!fs.existsSync(fpath)) return res.json({ ok: false, error: 'Dosya bulunamadı' });
    try {
      const raw = fs.readFileSync(fpath, 'utf8');
      const parsed = JSON.parse(raw);

      // _hareketler ayrı tabloya, geri kalanı AppState'e
      const { _hareketler, hareketler: _legacy, ...appData } = parsed;
      const hareketlerToRestore = _hareketler || _legacy || [];

      db.serialize(() => {
        db.run('BEGIN IMMEDIATE TRANSACTION');
        db.run('UPDATE AppState SET data = ?, version = 0 WHERE id = 1', [JSON.stringify(appData)], err => {
          if (err) { db.run('ROLLBACK'); return res.json({ ok: false, error: err.message }); }
          db.run('DELETE FROM Hareketler', err2 => {
            if (err2) { db.run('ROLLBACK'); return res.json({ ok: false, error: err2.message }); }
            if (!hareketlerToRestore.length) {
              db.run('COMMIT', err3 => {
                if (err3) return res.json({ ok: false, error: err3.message });
                res.json({ ok: true });
              });
              return;
            }
            const stmt = db.prepare(`
              INSERT INTO Hareketler (tarih, tur, depo, malzeme, miktar, birim, not_, skt, belge, personel)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            hareketlerToRestore.forEach(h => {
              stmt.run([
                h.tarih, h.tur, h.depo, h.malzeme, h.miktar,
                h.birim || null, h.not || null, h.skt || null,
                h.belge || null, h.personel || null,
              ]);
            });
            stmt.finalize(err3 => {
              if (err3) { db.run('ROLLBACK'); return res.json({ ok: false, error: err3.message }); }
              db.run('COMMIT', err4 => {
                if (err4) return res.json({ ok: false, error: err4.message });
                res.json({ ok: true });
              });
            });
          });
        });
      });
    } catch(e) { res.json({ ok: false, error: e.message }); }

  } else {
    res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  }
});

app.listen(PORT, () => {
  console.log(`Depo Takip sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
