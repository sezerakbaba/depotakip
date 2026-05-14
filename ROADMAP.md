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

## [ ] 4. app.js modülarize

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

## [ ] 5. Hareketler ayrı SQLite tablosuna

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
