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

db.serialize(() => {
  // Ana veri deposu (stok + hareketler JSON blob)
  db.run(`CREATE TABLE IF NOT EXISTS AppState (
    id INTEGER PRIMARY KEY,
    data TEXT
  )`);
  db.get('SELECT id FROM AppState WHERE id = 1', (_err, row) => {
    if (!row) db.run(`INSERT INTO AppState (id, data) VALUES (1, '{}')`);
  });
  // Migration: version kolonu (mevcut DB'de yoksa ekle, varsa hata sessizce yutulur)
  db.run(`ALTER TABLE AppState ADD COLUMN version INTEGER DEFAULT 0`);

  // Talepler tablosu
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
});

// ── ANA VERİ (load / save / reset / backup) ──────────────────────────────────
app.get('/api/api.php', (req, res) => {
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
    // MAX(id)+1 kullan — kayıt silinse bile çakışma olmaz
    db.get('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM Talepler', (err, row) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true, no: 'TLN-' + String(row.next).padStart(4, '0') });
    });

  } else if (action === 'istatistik') {
    // Server-side aggregation — appState JSON'unu parse et
    db.get('SELECT data FROM AppState WHERE id = 1', (err, row) => {
      if (err) return res.json({ ok: false, error: err.message });
      let appData = {};
      try { appData = JSON.parse(row.data); } catch(e) {}

      const hareketler = appData.hareketler || [];
      const stok       = appData.stok || {};

      // Son 6 ay trend (giriş/çıkış miktarı)
      const trend = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' });
        const ayHar = hareketler.filter(h => {
          const hd = new Date(h.tarih);
          return hd.getMonth() === d.getMonth() && hd.getFullYear() === d.getFullYear();
        });
        trend.push({
          label,
          giris: ayHar.filter(h => h.tur === 'Giriş').reduce((a, h) => a + (h.miktar || 0), 0),
          cikis: ayHar.filter(h => h.tur === 'Çıkış').reduce((a, h) => a + (h.miktar || 0), 0),
        });
      }

      // En aktif 5 malzeme
      const sayac = {};
      hareketler.forEach(h => { sayac[h.malzeme] = (sayac[h.malzeme] || 0) + 1; });
      const enAktif = Object.entries(sayac)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ad, cnt]) => ({ ad, cnt }));

      // Özet
      const bugun = new Date().toDateString();
      const ozet = {
        toplamHareket : hareketler.length,
        bugunGiris    : hareketler.filter(h => h.tur === 'Giriş'  && new Date(h.tarih).toDateString() === bugun).length,
        bugunCikis    : hareketler.filter(h => h.tur === 'Çıkış'  && new Date(h.tarih).toDateString() === bugun).length,
        toplamStokKalem: Object.values(stok).reduce((a, d) => a + Object.keys(d).length, 0),
      };

      res.json({ ok: true, trend, enAktif, ozet });
    });

  } else {
    res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  }
});

app.post('/api/api.php', (req, res) => {
  const action = req.query.action;

  if (action === 'save') {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz gövde' });
    }
    if (b.stok == null || typeof b.stok !== 'object' || Array.isArray(b.stok)) {
      return res.status(400).json({ ok: false, error: 'stok nesne olmalı' });
    }
    if (b.hareketler == null || !Array.isArray(b.hareketler)) {
      return res.status(400).json({ ok: false, error: 'hareketler dizi olmalı' });
    }
    if (b.hareketler.length >= 100000) {
      return res.status(400).json({ ok: false, error: 'hareketler çok büyük (max 100000)' });
    }
    for (const f of ['ozelMalzeme', 'silinmis', 'malzemeMeta']) {
      if (b[f] != null && (typeof b[f] !== 'object' || Array.isArray(b[f]))) {
        return res.status(400).json({ ok: false, error: f + ' nesne olmalı' });
      }
    }
    const clientVersion = (typeof b._version === 'number') ? b._version : null;
    const { _version, ...saveData } = b;
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
    db.run('UPDATE AppState SET data = "{}" WHERE id = 1', err => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true });
    });

  } else if (action === 'talep_kaydet') {
    const b = req.body || {};
    const err0 = validateTalep(b);
    if (err0) return res.status(400).json({ ok: false, error: err0 });
    if (!b.tarih) return res.status(400).json({ ok: false, error: 'tarih zorunlu' });

    // Atomik: no'yu önceden üret, tek INSERT ile yaz (transaction içinde)
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
    db.get('SELECT data FROM AppState WHERE id = 1', (err, row) => {
      if (err) return res.json({ ok: false, error: err.message });
      const backupDir = path.join(__dirname, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
      const ts = new Date().toISOString().slice(0,19).replace(/:/g,'-');
      const fname = `backup_${ts}.json`;
      try {
        fs.writeFileSync(path.join(backupDir, fname), row.data, 'utf8');
        rotateBackups(backupDir);
        res.json({ ok: true, dosya: fname });
      } catch(e) { res.json({ ok: false, error: e.message }); }
    });

  } else if (action === 'backup_yukle') {
    const { dosya } = req.body || {};
    if (!isStr(dosya, 80) || !BACKUP_NAME_RE.test(dosya)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz yedek adı' });
    }
    const backupDir = path.join(__dirname, 'backups');
    const fpath = path.join(backupDir, dosya);
    if (!fs.existsSync(fpath)) return res.json({ ok: false, error: 'Dosya bulunamadı' });
    try {
      const data = fs.readFileSync(fpath, 'utf8');
      JSON.parse(data); // validate
      db.run('UPDATE AppState SET data = ? WHERE id = 1', [data], err => {
        if (err) return res.json({ ok: false, error: err.message });
        res.json({ ok: true });
      });
    } catch(e) { res.json({ ok: false, error: e.message }); }

  } else {
    res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
  }
});

app.listen(PORT, () => {
  console.log(`Depo Takip sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
