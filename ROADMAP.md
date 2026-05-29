# Depo Takip — İyileştirme Yol Haritası

Her madde ayrı bir Claude Code oturumunda yapılacak. Oturum başında:
> "ROADMAP madde N'i yap"

Her madde tamamlanınca **commit** edilip bu dosyada `[x]` ile işaretlenecek.

---

## [x] 1. Auth + CORS kısıtlama

**Amaç:** Sunucu LAN'a açıkken yetkisiz erişim ve dış-origin isteklerini engelle.

**Dosyalar:** `server.js`, `public/index.html` (login formu), `public/js/app.js` (token gönderimi).

**Yapılacaklar:**
- `server.js` üstüne basit token kontrolü middleware'i ekle (env değişkeni `APP_TOKEN`, yoksa rastgele üret ve console'a yaz).
- Tüm `/api/*` rotalarını koru. Statik dosyalar serbest kalsın.
- `cors()`'u kaldır veya `origin: false` yap (aynı host'tan servis ediliyor).
- Frontend: token'ı `localStorage.depoToken`'da tut; yoksa basit prompt aç. Tüm `fetch` çağrılarına `Authorization: Bearer <token>` header'ı ekle (tek bir `apiFetch` helper'ı yap).

**Kabul kriteri:**
- Token'sız istek `401` döner.
- Yanlış origin'den istek reddedilir.
- Browser'da uygulama eski gibi çalışır (token girildikten sonra).

---

## [x] 2. Save endpoint validasyonu + transaction

**Amaç:** Çakışan yazımlarda veri kaybını ve bozuk payload kabul edilmesini önle.

**Dosyalar:** `server.js`, `public/js/app.js`.

**Yapılacaklar:**
- `action=save` için top-level şekil validasyonu: `stok` object, `hareketler` array, `ozelMalzeme`/`silinmis`/`malzemeMeta` object. Limitler (örn. hareketler.length < 100000).
- Yazımı `BEGIN IMMEDIATE TRANSACTION` içine al.
- `AppState` tablosuna `version INTEGER DEFAULT 0` kolonu ekle (CREATE'e ve mevcut row'a migration). Her save `version=version+1` yapsın ve döndürsün.
- Load `version`'u da döndürsün. Frontend `apiSave` payload'a son bilinen `version`'u koyar; sunucu farklıysa `409 Conflict` döner.
- Frontend 409'da kullanıcıya "Veriler başka yerden değişti, yeniden yükleniyor" toast'u + reload.

**Kabul kriteri:**
- Bozuk gövde (örn. `stok` array) `400` döner.
- İki sekme aynı anda yazınca ikincisi 409 alır, kayıp olmaz.

---

## [x] 3. Offline assets (Chart.js + lucide self-host)

**Amaç:** İnternet olmadan da çalışsın.

**Dosyalar:** `public/index.html`, yeni `public/vendor/` klasörü.

**Yapılacaklar:**
- `chart.umd.min.js` ve `lucide.min.js`'yi `public/vendor/`'a indir.
- IBM Plex fontunu local'e al (woff2) veya kabul edilebilirse system font'a düş.
- `index.html`'deki CDN linklerini local path'lere çevir.

**Kabul kriteri:**
- Network kapatılınca uygulama tam çalışır, grafikler ve ikonlar görünür.

---

## [x] 4. app.js modülarize

**Amaç:** 3181 satırlık tek dosyayı bakımı kolay parçalara böl.

**Dosyalar:** `public/js/app.js` → `public/js/` altında modüller. `index.html` script tag güncellenir.

**Yapılacaklar:**
- `<script type="module" src="js/main.js">` yapısına geç.
- Önerilen bölünme:
  - `api.js` — apiLoad/Save/Backup/Ping
  - `ayarlar.js` — ayarlar load/save/apply
  - `state.js` — global state (stok, hareketler, ...) + getter'lar
  - `ui-common.js` — toast, esc, fmt, modal helpers
  - `stok.js` — renderStok, openStokModal, kolon yönetimi
  - `hareket.js` — hareket CRUD + render
  - `talep.js` — talepname formu + listesi
  - `dashboard.js` — renderDashboard, charts
  - `kritik.js`, `malzeme.js`, `veri.js` — geri kalanlar
  - `main.js` — init, navigate, event wiring
- `onclick="foo()"` inline handler'lar modül export'larıyla çalışmaz — geçici olarak `window.foo = foo` ile expose et, ya da event delegation'a geç (tercih: window expose, daha az diff).

**Kabul kriteri:**
- Tüm sayfalar eskisi gibi çalışır.
- Hiçbir modül 600 satırı geçmez.
- Console'da hata yok.

---

## [x] 5. Hareketler ayrı SQLite tablosuna

**Amaç:** Hareket sayısı arttıkça her save'de tüm hareketleri POST etmek sürdürülemez. SQL ile tek-kayıt CRUD ve sunucu-taraflı agregasyon.

**Dosyalar:** `server.js`, `public/js/app.js` (veya 4. madde sonrası `hareket.js`/`api.js`).

**Yapılacaklar:**
- Yeni tablo:
  ```sql
  CREATE TABLE Hareketler (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tarih TEXT NOT NULL,
    tur TEXT NOT NULL,            -- 'Giriş' | 'Çıkış'
    depo TEXT NOT NULL,
    malzeme TEXT NOT NULL,
    miktar REAL NOT NULL,
    birim TEXT,
    not_ TEXT,
    skt TEXT,
    olusturma TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_har_tarih ON Hareketler(tarih);
  CREATE INDEX idx_har_depo_mal ON Hareketler(depo, malzeme);
  ```
- Migration: ilk başlangıçta `AppState.hareketler` varsa Hareketler'e kopyala, sonra `AppState` JSON'undan kaldır. Tek seferlik.
- Yeni endpoint'ler:
  - `GET ?action=hareket_list&offset=&limit=&depo=&malzeme=&tur=&tarih_min=&tarih_max=`
  - `POST ?action=hareket_ekle`
  - `POST ?action=hareket_sil` (id)
- `istatistik` action SQL ile yeniden yaz (`GROUP BY strftime('%Y-%m', tarih)`).
- Frontend: `hareketler` global array'i kaldır, gerektikçe sayfalı çek. Stok hesaplamaları için ya server-side `stok_view` action ekle ya da hareket toplama mantığını sunucuya taşı.

**Kabul kriteri:**
- Mevcut veriler kaybolmadan migrate olur (backup al, kontrol et).
- 10000+ hareket ile uygulama açılışı <1s.
- Save payload'ları hareket içermez, sadece `stok`/`ozelMalzeme`/`silinmis`/`malzemeMeta`.

---

## Sıra ve bağımlılık

1 → 2 → 3 → 4 → 5

- 1 ve 2 güvenlik/veri bütünlüğü, en kritik, önce.
- 3 küçük ve izole, ısınma için iyi.
- 4 büyük refactor, izole bir oturum hak ediyor.
- 5 en riskli (migration). 4'ten sonra modüler yapıda yapmak daha temiz.

Her maddenin başında **mutlaka** `backup_olustur` çalıştır.

---

# 2. Aşama — UI Refactor + Tasarım Sistemi (2026-05)

Aşama 1 (inline onclick → data-action) ve Aşama 2 (JS template
string handler'ları) ve **9 tasarım görevi** (H/A/C/B/G/D/E/F/J)
tamamlandı. PR [#2](https://github.com/sezerakbaba/depotakip/pull/2).

## [x] Aşama 1 — index.html inline onclick → data-action
## [x] Aşama 2 — JS template handler'ları + change/input/keydown
## [x] H — Bug temizliği (title sync, toast debounce, ölü kod)
## [x] A — Tasarım token'ları (tokens.css) + emoji → Lucide
## [x] C — Sticky topbar + sade sidebar
## [x] B — Buton/badge/modal komponent disiplini
## [x] G — Erişilebilirlik (klavye + ARIA + focus trap)
## [x] D — Dashboard + Stok sadeleştirme
## [x] E — Hareket + Kritik sadeleştirme
## [x] F — Talepname re-design (studio → sade A4)
## [x] J — Print stilleri

---

# 3. Aşama — Test, Süreç ve Takipler (planlanan)

Her madde ayrı bir Claude Code oturumunda yapılacak. Oturum başında:
> "ROADMAP S<n>'i yap" + worktree path

## 3.0 Acil — Test + bugfix

### [ ] S1. Tarayıcı test + bugfix
Dashboard, Stok, Hareket, Talepname (en kritik), Veri Yönet, Ayarlar +
3 modal + tema toggle + klavye gezinme + Ctrl+P print preview.
Console hataları + ekran görüntüleri ile dön. Bugfix commit'leri.

**Bağımlılık:** Hiçbiri — başlangıç noktası.

## 3.1 PR ve süreç

### [ ] S2. PR güncelleme + ultrareview
PR #2 başlığı ve gövdesini ~12 commit'i yansıtacak şekilde güncelle.
Sonra `/ultrareview` ile cloud review başlat, feedback'i issue'lara böl.

**Bağımlılık:** S1 (test edilmiş sürüm üzerinde review anlamlı).

## 3.2 Yüksek değerli takipler

### [ ] S3. CSP'yi aç
`helmet.contentSecurityPolicy` config: önce report-only, browser console
raporlarına göre kalan inline'ları temizle, sonra enforce.
`script-src 'self'` (inline JS gitti), `style-src 'self' 'unsafe-inline'`
(inline style'lar S9'a kadar kalır).

**Bağımlılık:** S1 (test edilmiş).

### [ ] S4. Personel filter + ölü kod
- `hareket.js` `apiHareketList`'e `personel` parametresi ekle, `server.js`
  `hareket_list` endpoint'inde `WHERE personel LIKE ?`.
- `escKey`/`escQ` kullanım yerlerini gözden geçir — inline handler yok,
  çoğu artık `esc` yeterli.
- `_pendingKritikler` global ve eski `.logo-badge` mobile CSS referansı
  gibi kalıntıları temizle.

**Bağımlılık:** Yok.

### [ ] S5. Form alanı hata UI'ı
Şu an form hataları toast ile gösteriliyor; alan-bazlı UI yok. `.field`
pattern'ine `.field--error` + `.field-hint` + `aria-invalid` ekle,
`setFieldError(id, msg)` helper'ı. Talep, stok modal, ayarlar, malzeme
ekle formlarında uygula.

**Bağımlılık:** Yok.

### [ ] S6. Notification HTTPS fallback
`Notification` API HTTP origin'de izin alamıyor. `location.protocol`
kontrolü ekle, HTTP'de "bu özellik HTTPS gerektiriyor" mesajıyla gri'le.

**Bağımlılık:** Yok.

## 3.3 Teknik borç

### [ ] S7. CSS modülerizasyonu
`style.css` 2300+ satır tek dosya. Şu yapıya böl:
```
css/tokens.css        (mevcut)
css/base.css          (reset, focus-visible)
css/layout.css        (sidebar, topbar, page-header, grid)
css/components/       (button.css, badge.css, card.css, form.css,
                       table.css, modal.css, chip.css, toast.css)
css/pages/            (dashboard, stok, hareket, talep, ayarlar)
css/print.css
```
Şimdilik `@import` ile tek `<link>` arkasında.

**Bağımlılık:** S1 (regresyon riski yüksek; test edilmiş baz şart).

### [ ] S8. Build pipeline + lint
- `esbuild` ile JS modüllerini concat + minify
- `postcss` ile CSS concat + autoprefixer
- ESLint + Prettier config
- En azından smoke test (`node server.js` + `curl /` 200 döner)

**Bağımlılık:** S7 (CSS modülarize sonrası concat anlamlı).

### [ ] S9. Inline style purge (son tur)
HTML'de hâlâ ~50 `style="..."` attribute'ü var. Hepsini class'a çek.
Kazanç: CSP'den `style-src 'unsafe-inline'` kaldırılabilir.

**Bağımlılık:** S7 (komponent CSS dosyaları yerinde olsun).

## 3.4 Gelecek özellikler

### [ ] S10. Topbar global arama (Ctrl+K)
Stok + depo + talep no araması, klavye odaklı. Modal'da liste + ok
tuşlarıyla seçim + Enter ile gitme.

**Bağımlılık:** Yok.

### [ ] S11. i18n şeması
Tüm Türkçe string'ler hard-coded. `i18n/tr.json` + key-based lookup
helper. EN için temel çeviri. Ayarlar'a dil seçimi.

**Bağımlılık:** Yok (ama büyük scope — 2-3 oturum).

### [ ] S12. Talep duplicate prevention
LocalStorage + server iki tarafı senkronize ediyor, id çakışabilir.
Server canonical olsun, local sadece cache.

**Bağımlılık:** Yok.

---

## Önerilen sıra

```
S1 (test+bugfix) ──┬─→ S2 (PR + review)
                   │
                   ├─→ S3 (CSP)
                   ├─→ S4 (personel + cleanup)
                   ├─→ S5 (form errors)
                   └─→ S6 (notification)
                   │
                   ├─→ S7 (CSS split) → S8 (build) → S9 (style purge)
                   │
                   └─→ S10 / S11 / S12  (özellikler, istek üzerine)
```

**Kritik yol:** S1 → S2. Sonrası paralel.
