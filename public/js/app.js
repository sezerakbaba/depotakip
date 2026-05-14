// ═══════════════════════════════════════════════════════════════════
// PHP API KATMANI — QNAP Web Server
// API_URL'yi QNAP IP'nize göre ayarlayın
// ═══════════════════════════════════════════════════════════════════
const API_URL = './api/api.php';  // aynı dizindeyse bu yeterli
let   API_MOD = false;            // PHP API aktif mi?
let   _saveTimer = null;          // debounce zamanlayıcı

function getToken() {
  let t = localStorage.getItem('depoToken');
  if (!t) {
    t = (window.prompt('Sunucu erişim tokenini girin:') || '').trim();
    if (t) localStorage.setItem('depoToken', t);
  }
  return t;
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}), Authorization: 'Bearer ' + token };
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401) {
    localStorage.removeItem('depoToken');
    toast('Geçersiz token — sayfayı yenileyin', 'error');
    throw new Error('401 Unauthorized');
  }
  return r;
}

// ═══════════════════════════════════════════════════════════════════
// AYARLAR — localStorage'a kaydedilir
// ═══════════════════════════════════════════════════════════════════
const AYARLAR_DEFAULT = {
  sktUyariGun:      365,
  sktKritikGun:     90,
  dashKritikLimit:  10,
  sonHareketLimit:  8,
  harSayfaBoy:      50,
  stokSayfaBoy:     100,
  tema:             'auto',
  yazitipiBoy:      100,
  tarihFormat:      'tr',
  katZorunlu:       false,
  hareketNot:       false,
  bildirimAktif:    false,
  varsayilanDepo:   '',
  varsayilanMinStok: 1,
  varsayilanMaxStok: 10,
  kurumAdi:         'Depo Yönetim Sistemi',
  talepSahibi:      '',
  talepOnaylayan1:  '',
  talepOnaylayan2:  '',
  talepOnaylayan3:  '',
  talepOnPek:       'TLN',
  birimler: ['adet','koli','paket','kutu','litre','kg','şişe','rulo','set','top','fıçı','çuval'],
  ekDepo:         [],
  ekKategori:     [],
  depoYeniadlar:  {},
  katYeniadlar:   {},
  stokSutunSirasi: ['depo','malzeme','kategori','mevcut','birim','min','max','durum','doluluk'],
  stokSutunGizli: [],
};
let ayarlar = { ...AYARLAR_DEFAULT };

function ayarlariYukle() {
  try {
    const stored = JSON.parse(localStorage.getItem('depoAyarlar') || '{}');
    ayarlar = { ...AYARLAR_DEFAULT, ...stored };
    (ayarlar.ekDepo || []).forEach(d => {
      DEPO_META[d.ad]  = { kod: d.kod, cls: '', color: d.color };
      DEPO_BADGE[d.ad] = '';
    });
    (ayarlar.ekKategori || []).forEach(k => {
      KAT_COLORS[k.ad] = { c: k.c, bg: k.bg };
    });
    // Kaydedilmiş depo adı değişikliklerini uygula
    Object.entries(ayarlar.depoYeniadlar || {}).forEach(([orig, yeni]) => {
      if (DEPO_META[orig] && orig !== yeni) {
        DEPO_META[yeni] = DEPO_META[orig]; delete DEPO_META[orig];
        DEPO_BADGE[yeni] = DEPO_BADGE[orig] || ''; delete DEPO_BADGE[orig];
      }
    });
    // Kaydedilmiş kategori adı değişikliklerini uygula
    Object.entries(ayarlar.katYeniadlar || {}).forEach(([orig, yeni]) => {
      if (KAT_COLORS[orig] && orig !== yeni) {
        KAT_COLORS[yeni] = KAT_COLORS[orig]; delete KAT_COLORS[orig];
      }
    });
  } catch(e) { ayarlar = { ...AYARLAR_DEFAULT }; }
  applyTheme();
}
function ayarlariKaydet() {
  localStorage.setItem('depoAyarlar', JSON.stringify(ayarlar));
}
function applyTheme() {
  const t = ayarlar.tema;
  if (t === 'dark')       document.documentElement.setAttribute('data-theme', 'dark');
  else if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else                    document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.fontSize = (ayarlar.yazitipiBoy || 100) + '%';
  const el = document.getElementById('sidebar-kurum-adi');
  if (el) el.textContent = ayarlar.kurumAdi || 'Depo Yönetim Sistemi';
}
function setAyar(key, val) {
  ayarlar[key] = val; ayarlariKaydet();
  if (key === 'kurumAdi') {
    const el = document.getElementById('sidebar-kurum-adi');
    if (el) el.textContent = val || 'Depo Yönetim Sistemi';
  }
  toast('Ayar kaydedildi ✓');
}
function setTema(t) {
  ayarlar.tema = t; applyTheme(); ayarlariKaydet(); renderAyarlar();
}

// API erişilebilir mi? (sayfa yüklenince test et)
async function apiPing() {
  try {
    const r = await apiFetch(API_URL + '?action=load', {signal: AbortSignal.timeout(3000)});
    if (r.ok) { API_MOD = true; return true; }
  } catch(e) {}
  return false;
}

// Sunucudan veri yükle
async function apiLoad() {
  try {
    const r    = await apiFetch(API_URL + '?action=load');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const json = await r.json();
    if (!json.ok) { console.error('API load:', json.error); return false; }
    const d = json.data;
    stok        = d.stok        || {};
    hareketler  = d.hareketler  || [];
    ozelMalzeme = d.ozelMalzeme || {};
    silinmis    = d.silinmis    || {};
    malzemeMeta = d.malzemeMeta || {};
    if (json.yeni) toast('İlk çalıştırma — boş veri oluşturuldu.', 'info');
    else toast('Veriler sunucudan yüklendi ✓');
    return true;
  } catch(e) {
    toast('Sunucuya bağlanılamadı: ' + e.message, 'error');
    return false;
  }
}

// Sunucuya veri kaydet (debounce: 800ms)
function apiSave() {
  if (!API_MOD) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      const payload = { stok, hareketler, ozelMalzeme, silinmis, malzemeMeta };
      const r    = await apiFetch(API_URL + '?action=save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      const json = await r.json();
      if (!json.ok) { toast('Kayıt hatası: ' + json.error, 'error'); return; }
      // Sessiz kayıt — başarılı bildirimi gösterme
      const _as = document.getElementById('api-status'); if(_as) _as.textContent = '💾 ' + new Date().toLocaleTimeString('tr-TR');
    } catch(e) {
      toast('Sunucu bağlantı hatası: ' + e.message, 'error');
    }
  }, 800);
}

// Yedek listesini çek
async function apiBackupList() {
  try {
    const r    = await apiFetch(API_URL + '?action=backup_list');
    const json = await r.json();
    if (!json.ok) return [];
    return json.yedekler || [];
  } catch(e) { return []; }
}

// Yedek oluştur
async function apiBackupOlustur() {
  if (!API_MOD) { toast('Sunucu bağlantısı yok', 'error'); return; }
  try {
    const r    = await apiFetch(API_URL + '?action=backup_olustur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const json = await r.json();
    if (json.ok) { toast(`Yedek alındı: ${json.dosya} ✓`); renderBackupList(); }
    else toast('Yedekleme hatası: ' + json.error, 'error');
  } catch(e) { toast('Sunucu hatası', 'error'); }
}

// Belirli yedeği yükle
async function apiBackupLoad(dosya) {
  if (!confirm(`"${dosya}" yedeği yüklenecek. Mevcut veriler silinecek. Devam edilsin mi?`)) return;
  try {
    const r    = await apiFetch(API_URL + '?action=backup_yukle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dosya })
    });
    const json = await r.json();
    if (!json.ok) { toast('Yedek yüklenemedi: ' + json.error, 'error'); return; }
    // Sayfayı yenile (en güvenli yol — state server'dan reload)
    toast('Yedek yüklendi — sayfa yenileniyor...');
    setTimeout(() => location.reload(), 1200);
  } catch(e) { toast('Yedek yüklenemedi', 'error'); }
}

// Sıfırla (sunucuda da sıfırla)
async function apiReset() {
  if (!API_MOD) return;
  try {
    await apiFetch(API_URL + '?action=reset', {method:'POST'});
  } catch(e) {
    console.warn('apiReset:', e);
    toast('Sunucuda sıfırlama başarısız: ' + e.message, 'error');
  }
}

// Diğer seçilince serbest giriş alanı göster/gizle
function handleDiger(selectEl, inputId) {
  const wrap = document.getElementById(inputId + '-wrap');
  if (!wrap) return;
  wrap.style.display = selectEl.value === 'Diğer' ? 'block' : 'none';
  if (selectEl.value !== 'Diğer') document.getElementById(inputId).value = '';
}
function getDigerVal(selectId, inputId) {
  const sel = document.getElementById(selectId);
  if (!sel) return '';
  if (sel.value === 'Diğer') {
    return (document.getElementById(inputId)?.value || '').trim() || 'Diğer';
  }
  return sel.value;
}

// ═══════════════════════════════════════════════════════════════════
// VERİ – Kaynak (salt okunur referans)
// ═══════════════════════════════════════════════════════════════════
const KAYNAK = {"Temizlik Deposu": [{"id": 1, "ad": "Pas ve Kireç Sökücü 30 kg", "sayim": "5 30 Kg"}, {"id": 2, "ad": "Çamaşır Suyu 30 kg", "sayim": "12 30 Kg"}, {"id": 3, "ad": "Sıvı Bulaşık Deterjanı", "sayim": "3 20 Kg"}, {"id": 4, "ad": "Sıvı El Sabunu", "sayim": "3 20 Kg"}, {"id": 5, "ad": "Köpük Sabun", "sayim": "10 11x5 Kg"}, {"id": 6, "ad": "Köpük Verici Sabunluk", "sayim": "1 adet"}, {"id": 7, "ad": "Katı Sabun (4'lü paket)", "sayim": "16 paket"}, {"id": 8, "ad": "Tex krem temizleyici", "sayim": "5 adet"}, {"id": 9, "ad": "Asperox Sarı Güç (1 litre)", "sayim": "16 adet"}, {"id": 10, "ad": "Lavabo Açıcı Asit (1 litre)", "sayim": "23 adet"}, {"id": 11, "ad": "Beyaz Sirke (1 litre)", "sayim": "24 adet"}, {"id": 12, "ad": "Oluklu Bulaşık Süngeri (5'li paket)", "sayim": "18 paket"}, {"id": 13, "ad": "Tuvalet Gider Kapağı", "sayim": "8 8 adet"}, {"id": 14, "ad": "Makarna Mop", "sayim": "17 17 adet"}, {"id": 15, "ad": "Mop aparatı (palet)", "sayim": "4 4 adet"}, {"id": 16, "ad": "Ahşap Mop Sapı", "sayim": "4 4 adet"}, {"id": 17, "ad": "Fırça-Faraş seti", "sayim": "9 9 set"}, {"id": 18, "ad": "Temizlik Bezi", "sayim": "54 adet"}, {"id": 19, "ad": "Çekpas ucu", "sayim": "9 adet"}, {"id": 20, "ad": "Lavabo fırçası", "sayim": "14 adet"}, {"id": 21, "ad": "Tüylü Fırça", "sayim": "2 koli (tahmini 250)"}, {"id": 22, "ad": "Bulaşık eldiveni", "sayim": "1 koli (tahmini 175 çift)"}, {"id": 23, "ad": "Otomatik Havlu Kağıdı (6'lı rulo)", "sayim": "23 23 paket"}, {"id": 24, "ad": "Tuvalet Kağıdı (32'li rulo)", "sayim": "21 21 paket"}, {"id": 25, "ad": "Kağıt Havlu (12'li rulo)", "sayim": "17 17 paket"}, {"id": 26, "ad": "Mavi Çöp Torbası (65*80 organik atık) kolide 50 rulo", "sayim": "15 koli (kolide 50 rulo)"}, {"id": 27, "ad": "Siyah Çöp Torbası (80*110) kolide 20 rulo", "sayim": "10 koli (kolide 20 rulo)"}, {"id": 28, "ad": "Kırmızı Tıbbi Atık Torbası (80*110 kolide 10 rulo)", "sayim": "71 koli"}, {"id": 29, "ad": "Kırmızı Tıbbi Atık Torbası (75*90 kolide 15 rulo)", "sayim": "33 koli"}, {"id": 30, "ad": "Mini boy Şeffaf Çöp Torbası (40*50 kolide 50 rulo)", "sayim": "3 paket (toplamdan -30)"}, {"id": 31, "ad": "5'lik şeffaf poşet (pakette 100 adet)", "sayim": "4 paket"}, {"id": 32, "ad": "2'lik şeffaf poşet (pakette 300 adet)", "sayim": "6 paket"}, {"id": 33, "ad": "1'lik şeffaf poşet (pakette 300 adet)", "sayim": "9 paket"}, {"id": 34, "ad": "Yarım kiloluk şeffaf poşet (pakette 450 adet)", "sayim": "3 paket"}, {"id": 35, "ad": "Kilitli Poşet 10*12 cm (kutuda 1000 adet)", "sayim": "3 kutu"}, {"id": 36, "ad": "Kilitli Poşet 11*14 cm (kutuda 1000 adet)", "sayim": "1 kutu"}, {"id": 37, "ad": "Kilitli Poşet 13*16 cm (kutuda 600 adet)", "sayim": "3 kutu"}, {"id": 38, "ad": "Kilitli Poşet 16*20 cm (kutuda 600 adet)", "sayim": "1 kutu"}, {"id": 39, "ad": "Kilitli Poşet 17*23 cm (kutuda 300 adet)", "sayim": "3 kutu"}, {"id": 40, "ad": "Kilitli Poşet 19*25 cm (kutuda 300 adet)", "sayim": "4 kutu"}, {"id": 41, "ad": "Zehirsiz Fare Yapışkanı", "sayim": "14 adet"}, {"id": 42, "ad": "Metal Kova", "sayim": "17 adet"}, {"id": 43, "ad": "Pedallı Çöp Kovası mini boy", "sayim": "6 adet"}, {"id": 44, "ad": "Tıbbi Atık Kutusu", "sayim": "36 + 25 adet (61 adet)"}, {"id": 45, "ad": "Eldiven XL kolide 20 adet", "sayim": "32 koli"}, {"id": 46, "ad": "Eldiven L kolide 20 adet", "sayim": "50 50 koli"}, {"id": 47, "ad": "Eldiven M (paket)", "sayim": "31 koli"}, {"id": 48, "ad": "Galoşmatik Galoşu", "sayim": "5 koli (kolide tahmini 1000 adet)"}, {"id": 49, "ad": "Çizme Galoşu", "sayim": "3 koli (toplam tahmini 40 adet)"}, {"id": 50, "ad": "Çizme", "sayim": "7 çift"}, {"id": 51, "ad": "Kaydırmaz Çizme Galoşu", "sayim": "2 koli (toplam tahmini 300 çift)"}, {"id": 52, "ad": "TYVEK Çizme Galoş (kutuda 200 adet)", "sayim": "12 kutu (toplamdan -40)"}, {"id": 53, "ad": "TYVEK S Tulum (kolide 100 adet)", "sayim": "1 koli (toplamdan -20)"}, {"id": 54, "ad": "TYVEK M Tulum (kolide 100 adet)", "sayim": "1 koli (toplamdan -20)"}, {"id": 55, "ad": "TYVEK XL Tulum (kolide 100 adet)", "sayim": "1 koli (toplamdan -25)"}, {"id": 56, "ad": "Afyondan gelen tulumlar L beden", "sayim": "7 koli (kolide 50 adet)"}, {"id": 57, "ad": "3M Maske", "sayim": "9 Koli (toplam 1160 adet)"}, {"id": 58, "ad": "FFP3 3M Maske (pakette 10 adet)", "sayim": "11 paket"}, {"id": 59, "ad": "FFP2 3M Maske (pakette 10 adet)", "sayim": "32 paket"}, {"id": 60, "ad": "FFP2 Maske", "sayim": "1 koli"}, {"id": 61, "ad": "FFP1 3M Maske (pakette 10 adet)", "sayim": "6 paket"}, {"id": 62, "ad": "N95 3M Maske (pakette 20 adet)", "sayim": "2 paket"}, {"id": 63, "ad": "Yerli Solunum Maskesi", "sayim": "1 kutu (kutuda 10 adet)"}, {"id": 64, "ad": "Telli Maske", "sayim": "15 koli (tahmini kolide 2000 adet)"}, {"id": 65, "ad": "Pandemi RTE Maske (Defacto)", "sayim": "16 kutu (tahmini kutuda 50 adet)"}, {"id": 66, "ad": "Koruyucu Gözlük", "sayim": "5 Koli (tahmini kolide 100 adet)"}, {"id": 67, "ad": "Mavi Önlük", "sayim": "2 koli (tahmini kolide 100 adet)"}, {"id": 68, "ad": "Bone (pakette 1000 adet)", "sayim": "3 paket"}, {"id": 69, "ad": "Şeffaf Saklama Kabı (kuduz için)", "sayim": "7 paket (tahmini pakette 100 adet)"}, {"id": 70, "ad": "A4 Kâğıdı", "sayim": "32 paket (pakette 5 adet)"}, {"id": 71, "ad": "A4 Telli Dosya (pakette 50 adet)", "sayim": "18 paket"}, {"id": 72, "ad": "Koli Bandı (pakette 6 adet)", "sayim": "3 paket"}, {"id": 73, "ad": "Yara Bandı", "sayim": "4 paket"}, {"id": 74, "ad": "Kırtasiye Bandı", "sayim": "20 adet"}, {"id": 75, "ad": "Çuval Ağzı İpi", "sayim": "7 adet"}, {"id": 76, "ad": "İmza Defteri", "sayim": "7 adet"}, {"id": 77, "ad": "Not Defteri (büyük boy)", "sayim": "6 koli (tahmini kolide 100 adet)"}, {"id": 78, "ad": "Notluk (küçük boy)", "sayim": "2 koli (tahmini kolide 150 adet)"}, {"id": 79, "ad": "Kırtasiye Makası", "sayim": "6 adet"}, {"id": 80, "ad": "Kırmızı Çizgili Kalem", "sayim": "40 adet"}, {"id": 81, "ad": "Mavi Çizgili Kalem", "sayim": "48 48 adet"}, {"id": 82, "ad": "Siyah Kurşun Kalem", "sayim": "10 adet"}, {"id": 83, "ad": "Kırmızı Kurşun Kalem", "sayim": "12 adet"}, {"id": 84, "ad": "Siyah Asetat Kalemi", "sayim": "3 adet"}, {"id": 85, "ad": "İmza Kalemi", "sayim": "13 13 adet"}, {"id": 86, "ad": "İmza Kalemi İçi", "sayim": "3 paket (toplam 45 adet)"}, {"id": 87, "ad": "Siyah M Cam Kalemi (pakette 10 adet)", "sayim": "3 paket"}, {"id": 88, "ad": "Siyah S Cam Kalemi (pakette 10 adet)", "sayim": "2 paket"}, {"id": 89, "ad": "Mavi M Cam Kalemi (pakette 10 adet)", "sayim": "1 paket"}, {"id": 90, "ad": "Mavi S Cam Kalemi (pakette 10 adet)", "sayim": "2 paket"}, {"id": 91, "ad": "Kırmızı Cam Kalemi (pakette 10 adet)", "sayim": "2 paket"}, {"id": 92, "ad": "Sarı Fosforlu Kalem", "sayim": "7 adet"}, {"id": 93, "ad": "Silgi", "sayim": "4 adet"}, {"id": 94, "ad": "Pritt Yapıştırıcı", "sayim": "1 adet"}, {"id": 95, "ad": "502 Süper Yapıştırıcı", "sayim": "1 adet"}, {"id": 96, "ad": "2032 Yuvarlak Pil", "sayim": "5 adet"}, {"id": 97, "ad": "Maket Bıçağı", "sayim": "5 adet"}, {"id": 98, "ad": "Maket Bıçağı Ucu (pakette 10 adet)", "sayim": "3 paket"}, {"id": 99, "ad": "Zımba Teli (15 kağıtlık)", "sayim": "5 paket (pakette 10 adet)"}, {"id": 100, "ad": "Zımba Teli (30 kağıtlık)", "sayim": "4 paket (pakette 10 adet)"}, {"id": 101, "ad": "Sekreter Tırnağı", "sayim": "5 adet"}, {"id": 102, "ad": "Ataş (4 no 100 adet)", "sayim": "9 paket (pakette 100 adet)"}, {"id": 103, "ad": "Ataş (3 no 100 adet)", "sayim": "5 paket (pakette 100 adet)"}, {"id": 104, "ad": "Zarf", "sayim": "6 kutu (tahmini kutuda 300 adet)"}, {"id": 105, "ad": "Büyük Boy Delgeç", "sayim": "4 adet"}, {"id": 106, "ad": "Büyük Boy Zımba", "sayim": "4 adet"}, {"id": 107, "ad": "Küçük Boy Zımba", "sayim": "4 adet"}, {"id": 108, "ad": "Şeffaf Poşet Dosya", "sayim": "12 paket (pakette 100 adet)"}, {"id": 109, "ad": "Tuvalet Fırçası", "sayim": "9 adet"}, {"id": 110, "ad": "cif krem temizleyici", "sayim": "18 adet"}, {"id": 111, "ad": "Asperox Mavi Güç (1 litre)", "sayim": "18 adet"}, {"id": 112, "ad": "Sıvı Sabun 400 ml", "sayim": "8 adet"}, {"id": 113, "ad": "arap sabunu", "sayim": "2 adet"}, {"id": 114, "ad": "ace 4 l çamaşır suyu", "sayim": "3 adet"}], "Orta Depo": [{"id": 1, "ad": "Siperlik (kolide ortalama 100 adet)", "sayim": "16 koli"}, {"id": 2, "ad": "Falcon Tüp 15ml (pakette 500 adet)", "sayim": "20 paket"}, {"id": 3, "ad": "Falcon Tüp 50ml (pakette 500 adet)", "sayim": "40 paket"}, {"id": 4, "ad": "Falcon Tüp Steril 15ml (bakteri)", "sayim": "8 koli (kolide ort 400 adet)"}, {"id": 5, "ad": "Falcon Tüp Steril 50ml (bakteri)", "sayim": "5 koli (kolide ort 400 adet)"}, {"id": 6, "ad": "Falcon Tüp 50ml (bakteri)", "sayim": "4 koli (kolide ort 400 adet)"}, {"id": 7, "ad": "Kimyasal Maskesi", "sayim": "17 koli + 13 adet (kolide tahmini 30 adet)"}, {"id": 8, "ad": "Kimyasal Maske Filtresi ()", "sayim": "38 paket (pakette 11 çift)"}, {"id": 9, "ad": "Çorap Swap", "sayim": "16 koli (kolide 10 paket/ pakette 10 adet)"}, {"id": 10, "ad": "Sünger Swap", "sayim": "7 kutu (kutuda 4 paket/ pakette 12 adet)"}, {"id": 11, "ad": "Toz Swap", "sayim": "3 paket (pakette 10 adet)"}, {"id": 12, "ad": "Dökme Pipet Ucu 200ul NEST", "sayim": "78 koli (kolide 10 paket/ pakette 1000 adet)"}, {"id": 13, "ad": "Mavi Önlük (Arşivden)", "sayim": "24 çuval (tahmini çuvalda 100 adet)"}, {"id": 14, "ad": "Mavi Önlük (Arşivden gelenler)", "sayim": "10 paket (tahmini pakette 100 adet)"}, {"id": 15, "ad": "Klavye/Mouse set (a4tech)", "sayim": "4 adet"}, {"id": 16, "ad": "Klavye/Mouse set (RAYNOX)", "sayim": "3 adet"}, {"id": 17, "ad": "Logitech kamera", "sayim": "1 adet"}, {"id": 18, "ad": "Toner 204U", "sayim": "4 adet"}, {"id": 19, "ad": "Toner 201A", "sayim": "3 adet (3)"}, {"id": 20, "ad": "Toner 12A", "sayim": "0 adet (yok)"}, {"id": 21, "ad": "Toner CB540A", "sayim": "1 adet"}, {"id": 22, "ad": "Toner CF219A", "sayim": "0 adet (yok)"}, {"id": 23, "ad": "Toner Q2612A", "sayim": "6 adet"}, {"id": 24, "ad": "Toner CESOSX", "sayim": "0 adet (yok)"}, {"id": 25, "ad": "Toner GREEN yüksek kaliteli", "sayim": "1 adet"}, {"id": 26, "ad": "Mini Termometre", "sayim": "1 adet"}, {"id": 27, "ad": "1,5V A76 ufak yuvarlak pil", "sayim": "8 adet"}, {"id": 28, "ad": "2032 yuvarlak pil", "sayim": "20 adet"}, {"id": 29, "ad": "oto buzdolabı", "sayim": "3 adet"}], "Asansör Yanı": [{"id": 1, "ad": "Nekropsi Seti", "sayim": "1 paket"}, {"id": 2, "ad": "U tabanlı mikropleyt", "sayim": "4 koli (kolide tahmini 120 tane)"}, {"id": 3, "ad": "96'lı pleyt kapağı", "sayim": "1 koli (kolide tahmini 120 tane)"}, {"id": 4, "ad": "Otoklav Bandı", "sayim": "10 adet"}, {"id": 5, "ad": "Parafilm", "sayim": "4 kutu"}, {"id": 6, "ad": "Test Pleyti", "sayim": "4 paket (pakette 64 adet)"}, {"id": 7, "ad": "Bistüri Ucu (100 adet/paket)", "sayim": "20 paket (20)"}, {"id": 8, "ad": "Musluklu Bidon", "sayim": "9 adet"}, {"id": 9, "ad": "Filtreli Pipet Ucu NEST 1000ul", "sayim": "33 paket (pakette 10 rack*96)"}, {"id": 10, "ad": "Cam Deney Tüpü", "sayim": "1 koli (tahmini 100 adet)"}, {"id": 11, "ad": "Cam Şişe 500ml", "sayim": "18 adet"}, {"id": 12, "ad": "Cam Şişe 1000ml", "sayim": "2 adet"}, {"id": 13, "ad": "Cam Şişe 1000ml amber", "sayim": "1 kutu (kutuda 10 adet)"}, {"id": 14, "ad": "Cam Şişe 500ml (kutuda 10)", "sayim": "1 kutu"}, {"id": 15, "ad": "Cam Şişe 250ml (kutuda 10)", "sayim": "3 kutu"}, {"id": 16, "ad": "Cam Şişe 100ml (kutuda 10)", "sayim": "1 kutu"}, {"id": 17, "ad": "Staining Jar (schiefferdecker)", "sayim": "7 adet"}, {"id": 18, "ad": "Staining Jar (hellendahl)", "sayim": "7 adet"}, {"id": 19, "ad": "Measuring Cylinder 1000ml", "sayim": "1 paket (pakette 2 adet)"}, {"id": 20, "ad": "Measuring Cylinder 500ml", "sayim": "2 paket (pakette 2 adet)"}, {"id": 21, "ad": "Measuring Cylinder 250ml", "sayim": "1 paket (pakette 2 adet)"}, {"id": 22, "ad": "Measuring Cylinder 50ml", "sayim": "1 paket (pakette 2 adet)"}, {"id": 23, "ad": "Cam Pipet 25ml", "sayim": "2 kutu (kutuda 10 adet)"}, {"id": 24, "ad": "Cam Pipet 5ml", "sayim": "2 kutu (kutuda 10 adet)"}, {"id": 25, "ad": "Cam Pipet 1ml", "sayim": "2 kutu (kutuda 10 adet)"}, {"id": 26, "ad": "Metal Cam Pipet Kutusu", "sayim": "3 adet"}, {"id": 27, "ad": "Vorsicht Glass (Bakteri/Pastör Pipet)", "sayim": "4 kutu (kutuda 250 adet)"}, {"id": 28, "ad": "Cam Kavanoz", "sayim": "12 paket (pakette 30 adet)"}, {"id": 29, "ad": "Kavanoz Kapağı", "sayim": "1 koli (tahmini 100 adet)"}, {"id": 30, "ad": "Mezur 2000ml", "sayim": "3 adet"}, {"id": 31, "ad": "Mezur 1000ml", "sayim": "2 adet"}, {"id": 32, "ad": "Beher 600ml", "sayim": "1 kutu (kutuda 10 adet)"}, {"id": 33, "ad": "Beher 250ml", "sayim": "1 kutu (kutuda 10 adet)"}, {"id": 34, "ad": "Erlen 250ml", "sayim": "1 kutu (kutuda 10 adet)"}, {"id": 35, "ad": "Flask cam malzeme 500ml", "sayim": "5 kutu (kutuda 10 adet)"}, {"id": 36, "ad": "Volumetric Flask 1000ml", "sayim": "3 kutu (kutuda 2 adet)"}, {"id": 37, "ad": "Volumetric Flask 500ml", "sayim": "2 kutu (kutuda 2 adet)"}, {"id": 38, "ad": "Volumetric Flask 100ml", "sayim": "7 kutu (kutuda 2 adet)"}, {"id": 39, "ad": "Kapaklı 1 Litre kap", "sayim": "1 koli (tahmini 30 adet)"}, {"id": 40, "ad": "Kırmızı Kapaklı Numune Kabı", "sayim": "1 koli (tahmini 150 adet)"}, {"id": 41, "ad": "ISOLAB tüp 0,5ml", "sayim": "6 paket (pakette 500 adet)"}, {"id": 42, "ad": "Rotorgene Q Strip tüp", "sayim": "1 kutu (20 adet)"}, {"id": 43, "ad": "1,5ml AXYGEN microtubes", "sayim": "49 kutu (kutuda 500 adet)"}, {"id": 44, "ad": "0,5ml PCR Tubes AXYGEN", "sayim": "9 kutu (kutuda 1000 adet)"}, {"id": 45, "ad": "0,2ml PCR Tubes AXYGEN", "sayim": "20 kutu (kutuda 2 paket/ pakette 500 adet)"}, {"id": 46, "ad": "0,1ml PCR Strip Tubes AXYGEN", "sayim": "30 kutu (kutuda 125 tüp&125 kapak)"}, {"id": 47, "ad": "2ml microtubes AXYGEN", "sayim": "20 paket (pakette 500 adet)"}, {"id": 48, "ad": "Petri Kabı (Büyük 9cm)", "sayim": "16 koli (kolide 450 adet)"}, {"id": 49, "ad": "Petri Kabı 60'lık", "sayim": "4 koli (kolide 800 adet)"}, {"id": 50, "ad": "Plastik Öze", "sayim": "4 koli (tahmini kolide 2000 adet)"}, {"id": 51, "ad": "Plastik Öze (kutuda 1000 adet)", "sayim": "45 kutu"}, {"id": 52, "ad": "Holder", "sayim": "3 koli (tahmini kolide 250 adet)"}, {"id": 53, "ad": "Falcon Tüp 15ml", "sayim": "2 (tahmini kolide 400 adet)"}, {"id": 54, "ad": "Falcon Tüp Steril 50ml", "sayim": "3 koli (tahmini kolide 400 adet)"}, {"id": 55, "ad": "Klasik Swap (kutuda 2000)", "sayim": "10 kutu"}, {"id": 56, "ad": "Pamuklu Swap", "sayim": "8 paket (pakette 1000 adet)"}, {"id": 57, "ad": "Siyah Pamuklu Swap", "sayim": "1 koli (tahmini 2000 adet)"}, {"id": 58, "ad": "Pipet Ucu NEST 200ul", "sayim": "9 koli (kolide 20 paket/ pakette 1000 adet)"}, {"id": 59, "ad": "Dökme Sarı Pipet Ucu 200ul", "sayim": "6 koli (tahmini kolide 20 paket/ pakette 1000 adet)"}, {"id": 60, "ad": "Dökme Pipet Ucu 1000ul", "sayim": "1 koli (tahmini kolide 20 paket/ pakette 1000 adet)"}, {"id": 61, "ad": "şırınga 20 ml", "sayim": "2 kutu (kutuda 125 adet)"}, {"id": 62, "ad": "Şırınga 50ml", "sayim": "4 kutu (kutuda 50 adet)"}, {"id": 63, "ad": "Şırınga 10ml", "sayim": "4 kutu (kutuda 200 adet)"}, {"id": 64, "ad": "Şırınga 5ml", "sayim": "3 kutu (kutuda 250 adet)"}, {"id": 65, "ad": "Şırınga 2ml", "sayim": "19 kutu (kutuda 300 adet)"}, {"id": 66, "ad": "Şırınga 1ml", "sayim": "7 kutu (kutuda 100 adet)"}, {"id": 67, "ad": "Kan Alma İğnesi", "sayim": "30 paket (pakette 100 adet)"}, {"id": 68, "ad": "Yeşil Eldiven", "sayim": "3 kutu (kutuda 10 çift)"}, {"id": 69, "ad": "Hücre Kültürü Flask 250ml", "sayim": "1 koli (tahmini 80 adet)"}, {"id": 70, "ad": "Hücre Kültürü Scraper", "sayim": "1 koli (tahmini 70 adet)"}, {"id": 71, "ad": "Hücre Kültürü Pleyt", "sayim": "2 koli (tahmini kolide 100 adet)"}, {"id": 72, "ad": "Hücre Kültürü Flask 50ml", "sayim": "9 kutu (kutuda 5 paket/ pakette 10 adet)"}, {"id": 73, "ad": "Hücre Kültürü Flask 250ml (paket)", "sayim": "16 kutu (kutuda 5 paket/ pakette 5 adet)"}, {"id": 74, "ad": "Hücre Kültürü Test Plate", "sayim": "14 kutu (tahmini kutuda 50 adet)"}, {"id": 75, "ad": "Serolojik Pipet ½ml", "sayim": "6 kutu (kutuda 40 adet)"}, {"id": 76, "ad": "Serolojik Pipet 1/10ml", "sayim": "4 kutu (kutuda 100 adet)"}, {"id": 77, "ad": "Serolojik Pipet 1/100ml", "sayim": "3 kutu (kutuda 200 adet)"}, {"id": 78, "ad": "Serolojik Pipet 10ml (KHT)", "sayim": "4 kutu (kutuda 200 adet)"}, {"id": 79, "ad": "Serolojik Pipet 5ml (KHT)", "sayim": "6 kutu (kutuda 200 adet)"}, {"id": 80, "ad": "Eppendorf Pipet ucu 10ul filtreli", "sayim": "1 kutu (kutuda 10 rack/ rack 96)"}, {"id": 81, "ad": "Eppendorf Pipet ucu 20ul filtreli", "sayim": "2 kutu (kutuda 10 rack/ rack 96)"}, {"id": 82, "ad": "Eppendorf Pipet ucu 200ul filtreli", "sayim": "2 kutu (kutuda 10 rack/ rack 96)"}, {"id": 83, "ad": "Filtreli Pipet Ucu NEST 200ul", "sayim": "25 kutu (kutuda 10 rack/ rack 96)"}, {"id": 84, "ad": "Filtreli Pipet Ucu NEST 20ul", "sayim": "19 kutu (kutuda 10 rack/ rack 96)"}, {"id": 85, "ad": "Filtreli Pipet Ucu NEST 10ul", "sayim": "34 kutu (kutuda 10 rack/ rack 96)"}, {"id": 86, "ad": "Filtreli pipet ucu brand 1000 ul", "sayim": "5 paket (kutuda 10 rack/ rack 96)"}, {"id": 87, "ad": "Filtreli Pipet Ucu BRAND 200ul", "sayim": "15 paket (kutuda 10 rack/ rack 96)"}, {"id": 88, "ad": "Filtreli Pipet Ucu BRAND 100ul", "sayim": "20 paket (kutuda 10 rack/ rack 96)"}, {"id": 89, "ad": "Filtreli Pipet Ucu BRAND 20ul", "sayim": "10 paket (kutuda 10 rack/ rack 96)"}, {"id": 90, "ad": "Filtreli Pipet Ucu Brand 10ul", "sayim": "15 paket (kutuda 10 rack/ rack 96)"}, {"id": 91, "ad": "Axygen Filtreli Pipet Ucu 100 ul", "sayim": "5 paket (kutuda 10 rack/ rack 96)"}, {"id": 92, "ad": "markasız 200 ul filtreli pipet ucu", "sayim": "1 koli (tahmini 30 rack*96)"}, {"id": 93, "ad": "Dökme Pipet Ucu BRAND 200ul", "sayim": "2 koli (kolide tahmini 400 adet)"}, {"id": 94, "ad": "Kırmızı Kan Tüpü", "sayim": "20 paket (pakette 100 adet)"}, {"id": 95, "ad": "Mor Kan Tüpü", "sayim": "18 paket (pakette 50 adet)"}, {"id": 96, "ad": "Sarı Kan Tüpü", "sayim": "2 paket (pakette 100 adet)"}, {"id": 97, "ad": "Microtube Rack", "sayim": "12 adet"}, {"id": 98, "ad": "Piset", "sayim": "18 adet"}, {"id": 99, "ad": "Cryogenic Storage Box", "sayim": "30 adet"}, {"id": 100, "ad": "Slide Box (100 slides)", "sayim": "0 adet (yok)"}, {"id": 101, "ad": "Slide Box (50 slides)", "sayim": "9 adet"}, {"id": 102, "ad": "Tube Rack 2ml", "sayim": "50 adet"}, {"id": 103, "ad": "Su Arıtma Cihazı Filtresi", "sayim": "4 adet"}, {"id": 104, "ad": "Sample Tubes 2ml", "sayim": "1 koli hibe (tahmini 300 adet)"}, {"id": 105, "ad": "Hücre Kültürü Flask 25cm2", "sayim": "2 koli hibe (kolide tahmini 100 adet)"}, {"id": 106, "ad": "Tülbent Bezi", "sayim": "1 top (10m2)"}, {"id": 107, "ad": "20 ul Filtreli Pipet ucu KIRGEN (bakteri)", "sayim": "9 paket (10 rack pakette)"}, {"id": 108, "ad": "200 ul Filtreli Pipet ucu KIRGEN (bakteri)", "sayim": "8 paket (10 rack pakette)"}, {"id": 109, "ad": "10 ul Filtreli pipet uvu kırgen (bakteri)", "sayim": "3 paket (10 rack pakette)"}, {"id": 110, "ad": "200 ul Filtreli Pipet ucu nest (bakteri)", "sayim": "5 paket (10 rack pakette)"}, {"id": 111, "ad": "100 ul Filtreli pipet ucu nest bakteri", "sayim": "8 paket (10 rack pakette)"}, {"id": 112, "ad": "20 ul Filtreli Pipet ucu nest (bakteri)", "sayim": "6 paket (10 rack pakette)"}, {"id": 113, "ad": "225 ml buffered peptone water şişesi", "sayim": "2 koli (kolide 25 adet)"}, {"id": 114, "ad": "pastör pipeti", "sayim": "10 paket (pakette tahmini 150 adet)"}, {"id": 115, "ad": "microscope slides", "sayim": "50 adet"}, {"id": 116, "ad": "microscope cover glasses", "sayim": "2 adet"}, {"id": 117, "ad": "160 mm makas", "sayim": "45 adet"}, {"id": 118, "ad": "130 mm makas", "sayim": "7 adet"}, {"id": 119, "ad": "130 mm pens", "sayim": "2 adet"}, {"id": 120, "ad": "150 mm pens", "sayim": "30 adet"}, {"id": 121, "ad": "kan torbası", "sayim": "5 ünite"}, {"id": 122, "ad": "plastik soğuk blok", "sayim": "2 tane"}, {"id": 123, "ad": "metal boncuk", "sayim": "15 adet"}, {"id": 124, "ad": "mini termometre", "sayim": "20 adet"}], "Kimyasal Deposu": [{"id": 1, "ad": "Detrox (fümigasyon cihazı)", "sayim": "36 adet"}, {"id": 2, "ad": "Virkon S", "sayim": "4 adet"}, {"id": 3, "ad": "Biodes Konsantre Dezenfektan (5l)", "sayim": "5 adet"}, {"id": 4, "ad": "Biocan-a Konsantre Toz Dezenfektan (1kg)", "sayim": "83 adet"}, {"id": 5, "ad": "El Dezenfektanı (1Litre)", "sayim": "10 adet"}, {"id": 6, "ad": "Göz Yıkama Seti", "sayim": "10 adet"}, {"id": 7, "ad": "Ksilen 5 Litre", "sayim": "10 adet"}, {"id": 8, "ad": "Lugol Solüsyonu %5", "sayim": "1 adet"}, {"id": 9, "ad": "Tris (C4H11NO3)", "sayim": "2 adet"}, {"id": 10, "ad": "Edta, Free Acid", "sayim": "1 adet"}, {"id": 11, "ad": "Boric Acid (H3BO3)", "sayim": "1 adet"}, {"id": 12, "ad": "Agarose (jel elektroforez)", "sayim": "2 adet"}, {"id": 13, "ad": "Buffer Solution", "sayim": "2 adet"}, {"id": 14, "ad": "Methanol (2,5L)", "sayim": "2 adet"}, {"id": 15, "ad": "Chloroform", "sayim": "1 adet"}, {"id": 16, "ad": "Teksol Sanayi Makine Temizleyici (5l)", "sayim": "84 adet"}, {"id": 17, "ad": "Ethanol Absolute %99", "sayim": "72 adet"}, {"id": 18, "ad": "Gliserin %99,5 (2,5L)", "sayim": "0 adet (yok)"}, {"id": 19, "ad": "Acetic Acid (glacial) 2,5L", "sayim": "0 adet (yok)"}, {"id": 20, "ad": "Dietil Eter 1L", "sayim": "1 adet"}, {"id": 21, "ad": "Dietil Eter 2,5L", "sayim": "1 adet"}, {"id": 22, "ad": "Ziehl-Neelsen Carbol-Fuchsin", "sayim": "3 adet"}, {"id": 23, "ad": "İmmersion Oil (100ml)", "sayim": "2 adet"}, {"id": 24, "ad": "Entellan (500ml)", "sayim": "0 adet (yok)"}, {"id": 25, "ad": "Propanol (500ml)", "sayim": "2 adet"}, {"id": 26, "ad": "Aseton", "sayim": "1 fıçı"}, {"id": 27, "ad": "Sellers Boyama", "sayim": "2 adet"}, {"id": 28, "ad": "Formaldehyde Solution", "sayim": "1 adet"}, {"id": 29, "ad": "Ph4 Buffer Solution HI5004", "sayim": "1 adet"}, {"id": 30, "ad": "Ph4 Buffer Solution HI7004", "sayim": "1 adet"}, {"id": 31, "ad": "Ph10 Buffer Solution", "sayim": "1 adet"}, {"id": 32, "ad": "Ethylenediaminetetraacetic Acid", "sayim": "1 adet"}, {"id": 33, "ad": "Sodium Azide", "sayim": "1 adet"}, {"id": 34, "ad": "Dimethyl Sulfoxid", "sayim": "1 adet"}, {"id": 35, "ad": "Tryptose Phosphate Broth", "sayim": "1 adet"}, {"id": 36, "ad": "Glucose", "sayim": "1 adet"}, {"id": 37, "ad": "Phenolrot", "sayim": "1 adet"}, {"id": 38, "ad": "Sodyum Hidrojen Karbonat", "sayim": "1 adet"}, {"id": 39, "ad": "Evans Blue", "sayim": "1 adet"}, {"id": 40, "ad": "Trizma Base 900g", "sayim": "1 adet"}, {"id": 41, "ad": "Di-Potassium Hydrogen Phosphate 600g", "sayim": "1 adet"}, {"id": 42, "ad": "Sodium Hydrogen Carbonate 900g", "sayim": "1 adet"}, {"id": 43, "ad": "Sodium Hydroxide 600g", "sayim": "1 adet"}, {"id": 44, "ad": "Nitric Acid 2,3 Litre", "sayim": "1 adet"}, {"id": 45, "ad": "Formic Acid %98 900ml", "sayim": "1 adet"}, {"id": 46, "ad": "Acetic Acid (glacial) 2,2L", "sayim": "1 adet"}, {"id": 47, "ad": "Di Sodium Hydrogen Phosphate 400g", "sayim": "1 adet"}, {"id": 48, "ad": "Buffer Solution", "sayim": "3"}, {"id": 49, "ad": "Propanol 2,5 litre cam şişe (SUPELCO)", "sayim": "1 adet"}, {"id": 50, "ad": "Propanol 2,5 litre for analysis (SUPELCO)", "sayim": "4 adet"}, {"id": 51, "ad": "Neo-Mount (500ml)", "sayim": "1 adet"}, {"id": 52, "ad": "Tyrosine (100g)", "sayim": "2 adet"}, {"id": 53, "ad": "Hydrogen Peroxide %35 2,5L", "sayim": "1 adet"}, {"id": 54, "ad": "Saf Su 5 litre", "sayim": "1 adet"}, {"id": 55, "ad": "Cell Culture Water (500ml)", "sayim": "1 adet"}, {"id": 56, "ad": "Parafin Boncuk 2,5 Kg", "sayim": "2 adet"}, {"id": 57, "ad": "Carbol Fuchsin Solution 1000ml", "sayim": "2 adet"}, {"id": 58, "ad": "Salicylic Acid 1 Kg", "sayim": "1 adet"}, {"id": 59, "ad": "Rose-Bengal Agar 500g", "sayim": "1 adet"}, {"id": 60, "ad": "Potassium Chloride 1 kg", "sayim": "3 adet"}, {"id": 61, "ad": "Copper(II) Sulfate Pentahydrate", "sayim": "1 adet"}, {"id": 62, "ad": "Kaliumiodid 1 kg", "sayim": "1 adet"}, {"id": 63, "ad": "Natriumdodecylsulfat 1 kg", "sayim": "1 adet"}, {"id": 64, "ad": "Bakır Tuzu", "sayim": "1 adet"}, {"id": 65, "ad": "Silica", "sayim": "1 adet"}, {"id": 66, "ad": "Iron(III) Chloride Hexahydrate", "sayim": "1 adet"}, {"id": 67, "ad": "Essigsaure 2,5 Litre", "sayim": "0 adet (YOK)"}, {"id": 68, "ad": "Propanol 2,5 litre (ISOLAB)", "sayim": "1 adet"}], "Kuş Gribi Deposu": [{"id": 1, "ad": "Veteriner Çantası", "sayim": "37 adet"}, {"id": 2, "ad": "Metal Malzeme Kutusu", "sayim": "17 adet"}, {"id": 3, "ad": "Şeffaf Tüp Saklama Kutusu", "sayim": "61 koli (kolide 187 adet)"}, {"id": 4, "ad": "Holder", "sayim": "5 koli (kolide 20000 adet)"}, {"id": 5, "ad": "swap", "sayim": "36 koli (kolide 40 paket pakette 50 adet)"}, {"id": 6, "ad": "Eppendorf Tüp (fıratmed)", "sayim": "20 koli (kolide 10 paket pakette 1000 adet)"}]}
const DEPO_META = {
  'Temizlik Deposu':  {kod:'TD',  cls:'depo-td',  color:'#0277bd'},
  'Orta Depo':        {kod:'OD',  cls:'depo-od',  color:'#2e7d32'},
  'Asansör Yanı':     {kod:'AY',  cls:'depo-ay',  color:'#6a1b9a'},
  'Kimyasal Deposu':  {kod:'KD',  cls:'depo-kd',  color:'#bf360c'},
  'Kuş Gribi Deposu': {kod:'KGD', cls:'depo-kgd', color:'#b71c1c'},
};
const DEPO_BADGE = {'Temizlik Deposu':'badge-td','Orta Depo':'badge-od','Asansör Yanı':'badge-ay','Kimyasal Deposu':'badge-kd','Kuş Gribi Deposu':'badge-kgd'};

// ═══════════════════════════════════════════════════════════════════
// UYGULAMA STATE  –  tüm sayfalar bu nesneleri okur
// ═══════════════════════════════════════════════════════════════════
// FIX: Başlangıçta stok nesnesi boş; getStok() artık min/max=0 döndürür
// böylece hiçbir malzeme "kritik" görünmez, kullanıcı kendi değerlerini girer.
let stok       = {};   // key:"depo||malzeme" → {mevcut,min,max}
let hareketler = [];   // [{id,tarih,depo,malzeme,tur,miktar,belge,personel,not}]
let ozelMalzeme= {};   // key:"depo||malzeme" → {ad,sayim,depo} (kullanıcı eklemeleri)
let silinmis   = {};   // key:"depo||malzeme" → true (silinen kaynak malzemeler)

let stokDepoFilter='Tümü';
let stokDurumFilter='';
let stokKatFilter='Tümü';
let malzemeMeta={};
let harFilter          = 'Tümü';
let harDepoFilter      = '';
let harTarihBas        = '';
let harTarihBit        = '';
let harPersonelFilter  = '';
let harSayfa        = 0;
// ayarlar.harSayfaBoy → ayarlar.harSayfaBoy ile dinamik
let editKey         = null;
let aktifSayfa      = 'dashboard';
let chartDepo, chartDurum, chartTrend, chartKritikDepo, chartDurum2;
let talepNo = 1, talepSatirCount = 0;
let _talepListesi = [];  // cache for talep-listesi page
let _viewTalep    = null; // talep to display in form (from list view)
let _pendingKritikler = null; // set by kritikTalepAktar to pass kritik rows into initTalep

// ═══════════════════════════════════════════════════════════════════
// YARDIMCI FONKSİYONLAR
// ═══════════════════════════════════════════════════════════════════
function getKey(depo, mal) { return depo + '||' + mal; }

// XSS koruması: HTML metin bağlamı için
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// FIX: Varsayılan min=0, max=0 → stok girilmeden hiçbir şey kritik değil
function getStok(depo, mal) {
  const k = getKey(depo, mal);
  if (!stok[k]) stok[k] = {mevcut: 0, min: 0, max: 0};
  return stok[k];
}

// Tüm malzemeleri (kaynak + özel, silinmişler hariç) döndürür
function getAllItems() {
  const result = [];
  for (const [dep, items] of Object.entries(KAYNAK)) {
    for (const item of items) {
      const k = getKey(dep, item.ad);
      if (silinmis[k]) continue;
      const _mk=getKey(dep,item.ad);const _mm=malzemeMeta[_mk]||{};
      result.push({depo:dep,ad:item.ad,sayim:item.sayim,ozel:false,birim:_mm.birim||'',kategori:_mm.kategori||''});
    }
  }
  for (const [k, item] of Object.entries(ozelMalzeme)) {
    if (silinmis[k]) continue;  // özel malzeme de silinebilir
    const _omm=malzemeMeta[k]||{};
    result.push({depo:item.depo,ad:item.ad,sayim:item.sayim,ozel:true,birim:item.birim||_omm.birim||'',kategori:item.kategori||_omm.kategori||''});
  }
  return result;
}

function getDepoItems(dep) {
  return getAllItems().filter(i => i.depo === dep);
}

function durum(mevcut, min, max) {
  if (mevcut === 0) return 'Kritik';           // stok sıfır → her zaman kritik
  if (min === 0 && max === 0) return 'Normal'; // stok tanımlanmamış → nötr
  if (mevcut <= min) return 'Kritik';
  if (max > 0 && mevcut >= max) return 'Fazla';
  return 'Normal';
}

function durumBadge(d) {
  const map  = {Kritik:'badge-kritik', Normal:'badge-normal', Fazla:'badge-fazla'};
  const icon = {Kritik:'⚠', Normal:'✓', Fazla:'↑'};
  return `<span class="badge ${map[d]}">${icon[d]} ${d}</span>`;
}

function depoBadge(dep) {
  const m = DEPO_META[dep];
  if (!m) return `<span class="badge">${esc(dep)}</span>`;
  if (DEPO_BADGE[dep]) return `<span class="badge ${DEPO_BADGE[dep]}">${esc(m.kod)}</span>`;
  return `<span class="badge" style="background:${m.color}22;color:${m.color}">${esc(m.kod)}</span>`;
}

function fmtGun(d) {
  if (!(d instanceof Date)) d = new Date(d);
  if (ayarlar.tarihFormat === 'iso') {
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  return d.toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function fmt(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return fmtGun(d) + ' ' + d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
}

function toast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = (type==='success'?'✓  ':type==='info'?'ℹ  ':'✕  ') + msg;
  t.className = 'show ' + type;
  setTimeout(()=> t.className='', 2800);
}

// FIX: Merkezi yenileme – hareket/stok değişiminde tüm açık sayfa verisi güncellenir
function refreshAll() {
  apiSave();  // Her değişiklikte otomatik kaydet
  if (aktifSayfa === 'dashboard')    renderDashboard();
  if (aktifSayfa === 'stok')         renderStok();
  if (aktifSayfa === 'kritik')       renderKritik();
  if (aktifSayfa === 'istatistik')   renderIstatistik();
  if (aktifSayfa === 'hareket')      renderHareketList();
  if (aktifSayfa === 'malzeme-ekle') renderMalzemeEkleList();
  if (aktifSayfa === 'veri-yonet')   refreshVeriYonet();
  if (aktifSayfa === 'depo-detay')   { const d=document.getElementById('detay-content'); if(d&&window._aktifDetayDep) goDetay(window._aktifDetayDep); }
  checkKritikNotification();
}

// ── Tarayıcı bildirimleri ─────────────────────────────────────────
let _sonBildirimZamani = 0;
function checkKritikNotification() {
  if (!ayarlar.bildirimAktif) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  if (now - _sonBildirimZamani < 5 * 60 * 1000) return; // en fazla 5 dakikada bir
  const kritikler = getAllItems().filter(i => durum(getStok(i.depo, i.ad).mevcut, getStok(i.depo, i.ad).min, getStok(i.depo, i.ad).max) === 'Kritik');
  if (kritikler.length === 0) return;
  _sonBildirimZamani = now;
  new Notification('Kritik Stok Uyarısı — ' + (ayarlar.kurumAdi || 'DYS'), {
    body: `${kritikler.length} malzeme kritik: ${kritikler.slice(0, 3).map(i => i.ad).join(', ')}${kritikler.length > 3 ? '…' : ''}`,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="24" font-size="24">⚠️</text></svg>'
  });
}

async function bildirimIzniSor() {
  if (!('Notification' in window)) { toast('Tarayıcınız bildirimleri desteklemiyor.', 'error'); return; }
  if (ayarlar.bildirimAktif) { setAyar('bildirimAktif', false); toast('Bildirimler kapatıldı.'); renderAyarlar(); return; }
  if (Notification.permission === 'denied') { toast('Bildirimler tarayıcı tarafından engellendi. Tarayıcı ayarlarından izin verin.', 'error'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') { setAyar('bildirimAktif', true); toast('Bildirimler aktif ✓'); }
  else { setAyar('bildirimAktif', false); toast('Bildirim izni verilmedi.', 'error'); }
  renderAyarlar();
}

// ── Hareket Excel dışa aktarım ────────────────────────────────────
async function exportHareketExcel() {
  if (!window.XLSX) {
    toast('Excel kütüphanesi yükleniyor...');
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = res; s.onerror = () => rej(new Error('SheetJS yüklenemedi'));
      document.head.appendChild(s);
    }).catch(e => { toast('Excel kütüphanesi yüklenemedi: ' + e.message, 'error'); throw e; });
  }
  const q = (document.getElementById('har-search')?.value || '').toLowerCase();
  const filtered = hareketler.filter(h => {
    if (harFilter !== 'Tümü' && h.tur !== harFilter) return false;
    if (harDepoFilter && h.depo !== harDepoFilter) return false;
    if (harPersonelFilter && !(h.personel||'').toLowerCase().includes(harPersonelFilter.toLowerCase())) return false;
    if (q && !h.malzeme.toLowerCase().includes(q) && !h.depo.toLowerCase().includes(q) &&
        !(h.personel||'').toLowerCase().includes(q) && !(h.belge||'').toLowerCase().includes(q)) return false;
    if (harTarihBas) { const hd = new Date(h.tarih); hd.setHours(0,0,0,0); if (hd < new Date(harTarihBas + 'T00:00:00')) return false; }
    if (harTarihBit) { const hd = new Date(h.tarih); hd.setHours(0,0,0,0); if (hd > new Date(harTarihBit + 'T00:00:00')) return false; }
    return true;
  }).slice().reverse();
  if (filtered.length === 0) { toast('Dışa aktarılacak kayıt yok.', 'error'); return; }
  const rows = [['Tarih', 'Depo', 'Malzeme', 'Tür', 'Miktar', 'Belge No', 'Personel', 'Not']];
  filtered.forEach(h => rows.push([
    new Date(h.tarih).toLocaleString('tr-TR'), h.depo, h.malzeme,
    h.tur, h.miktar, h.belge || '', h.personel || '', h.not || ''
  ]));
  const wb = window.XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Hareket Geçmişi');
  XLSX.writeFile(wb, 'hareket_' + new Date().toLocaleDateString('tr-TR').replace(/\./g, '-') + '.xlsx');
  toast(`${filtered.length} kayıt Excel'e aktarıldı ✓`);
}


// ═══════════════════════════════════════════════════════════════════
// NAVİGASYON
// ═══════════════════════════════════════════════════════════════════
const PAGE_TITLES = {
    dashboard:     'Dashboard',
    stok:          'Stok Listesi',
    hareket:       'Giriş / Çıkış',
    istatistik:    'İstatistikler',
    kritik:        'Kritik Stok',
    talep:          'Talepname',
    'talep-listesi':'Talep Listesi',
    'depo-detay':   'Depo Detayı',
    'malzeme-ekle':'Malzeme Yönetimi',
    'veri-yonet':  'Veri Yönetimi',
    'ayarlar':     'Ayarlar',
  };

function navigate(page) {
  aktifSayfa = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const ni = document.querySelector(`.nav-item[onclick*="'${page}'"]`);
  if (ni) ni.classList.add('active');

  // Mobilde sidebar açıksa kapat
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb && sb.classList.contains('open')) { sb.classList.remove('open'); ov?.classList.remove('open'); }

  if (page === 'dashboard')    renderDashboard();
  if (page === 'stok')         renderStok();
  if (page === 'hareket') {
    renderHareketList();
  }
  if (page === 'istatistik')   renderIstatistik();
  if (page === 'kritik')       renderKritik();
  if (page === 'talep')          initTalep();
  if (page === 'talep-listesi')  renderTalepListesi();
  if (page === 'malzeme-ekle') {
    renderMalzemeEkleList();
    const _nd = document.getElementById('yeni-depo');
    const _nm = document.getElementById('yeni-min');
    const _nx = document.getElementById('yeni-max');
    if (_nd && ayarlar.varsayilanDepo) _nd.value = ayarlar.varsayilanDepo;
    if (_nm) _nm.value = ayarlar.varsayilanMinStok ?? 1;
    if (_nx) _nx.value = ayarlar.varsayilanMaxStok ?? 10;
  }
  if (page === 'ayarlar')      renderAyarlar();
  if (page === 'veri-yonet') {
    refreshVeriYonet();
    const dk = document.getElementById('api-durum-kart');
    const dt = document.getElementById('api-durum-text');
    const ds = document.getElementById('api-durum-sub');
    const di = document.getElementById('api-durum-icon');
    if (dk) dk.style.display='block';
    if (API_MOD) {
      if(di) di.textContent='🟢';
      if(dt) dt.textContent='Sunucu bağlı — veriler otomatik kaydediliyor';
      if(ds) ds.textContent=API_URL;
    } else {
      if(di) di.textContent='🔴';
      if(dt) dt.textContent='Sunucu bağlantısı yok — veriler yalnızca bu oturumda mevcut';
      if(ds) ds.textContent='api/api.php erişilemiyor';
    }
    renderBackupList();
  }
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function renderDashboard() {
  const tümü = getAllItems();
  let kritikC = 0, normalC = 0;
  const _now2 = new Date(); _now2.setHours(0,0,0,0);
  tümü.forEach(i => {
    const s  = getStok(i.depo, i.ad);
    const mm = malzemeMeta[getKey(i.depo,i.ad)]||{};
    const isSktKritik = mm.skt && Math.round((new Date(mm.skt)-_now2)/86400000) <= 0;
    if (durum(s.mevcut, s.min, s.max) === 'Kritik' || isSktKritik) kritikC++;
    else normalC++;
  });
  const bugun = hareketler.filter(h => new Date(h.tarih).toDateString() === new Date().toDateString()).length;

  document.getElementById('s-toplam').textContent  = tümü.length;
  document.getElementById('s-normal').textContent  = normalC;
  document.getElementById('s-kritik').textContent  = kritikC;
  document.getElementById('s-hareket').textContent = bugun;

  // Trend göstergeleri
  const dun = hareketler.filter(h=>{
    const d=new Date(h.tarih); const dn=new Date();
    dn.setDate(dn.getDate()-1);
    return d.toDateString()===dn.toDateString();
  }).length;

  function trendHTML(val, ref, suffix) {
    if(ref===0&&val===0) return '<span class="stat-trend trend-neu">— değişim yok</span>';
    if(val>ref) return '<span class="stat-trend trend-up">↑ '+val+' '+suffix+'</span>';
    if(val<ref) return '<span class="stat-trend trend-down">↓ '+val+' '+suffix+'</span>';
    return '<span class="stat-trend trend-neu">= '+val+' '+suffix+'</span>';
  }

  const nt=document.getElementById('s-normal-trend');
  const kt=document.getElementById('s-kritik-trend');
  const ht=document.getElementById('s-hareket-trend');
  if(nt) nt.innerHTML = tümü.length>0 ? '<span class="stat-trend trend-up" style="font-size:10px">%'+Math.round(normalC/tümü.length*100)+' yeterli</span>' : '';
  if(kt) kt.innerHTML = kritikC>0 ? '<span class="stat-trend trend-down" style="font-size:10px">⚠ '+kritikC+' kritik</span>' : '<span class="stat-trend trend-up" style="font-size:10px">✓ Kritik yok</span>';
  if(ht) ht.innerHTML = trendHTML(bugun, dun, 'işlem');

  // 7-günlük sparkline
  const sparkEl = document.getElementById('dash-sparkline');
  if (sparkEl) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toDateString();
      days.push(hareketler.filter(h => new Date(h.tarih).toDateString() === ds).length);
    }
    const maxV = Math.max(...days, 1);
    const W = 72, H = 22, pad = 3;
    const pts = days.map((v, i) => `${pad + i * (W - pad*2) / 6},${H - pad - (v / maxV) * (H - pad*2)}`).join(' ');
    const cx  = pad + 6 * (W - pad*2) / 6;
    const cy  = H - pad - (days[6] / maxV) * (H - pad*2);
    sparkEl.innerHTML = `<svg style="width:100%;max-width:${W}px;display:block" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polyline points="${pts}" style="fill:none;stroke:var(--red);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round;opacity:.45"/>
      <circle cx="${cx}" cy="${cy}" r="2.5" style="fill:var(--red)"/>
    </svg>`;
  }

  // Depo kartları — Düzen C kompakt
  const dc = document.getElementById('depo-cards');
  dc.innerHTML = '';
  for (const [dep, meta] of Object.entries(DEPO_META)) {
    const items = getDepoItems(dep);
    let dk = 0;
    items.forEach(it => { const s = getStok(dep, it.ad); if (durum(s.mevcut,s.min,s.max)==='Kritik') dk++; });
    const cntHtml = dk > 0
      ? `<span style="color:var(--red)">⚠ ${dk} kritik</span>`
      : `<span style="color:var(--green)">✓ ${items.length} kalem</span>`;
    const pctNormal = items.length > 0 ? Math.round((items.length - dk) / items.length * 100) : 100;
    const dotColor  = meta.color || '#aaa';
    dc.innerHTML += `
      <div class="c-depo-card" onclick="goDetay('${escQ(dep)}')">
        <div class="c-depo-dot" style="background:${dotColor}"></div>
        <div class="c-depo-info">
          <div class="c-depo-name" style="color:${dotColor}">${esc(dep)}</div>
          <div class="c-depo-cnt">${cntHtml}</div>
          <div style="height:3px;border-radius:3px;background:${dk>0?'rgba(211,47,47,.2)':'var(--line)'};overflow:hidden;margin-top:6px">
            <div style="height:100%;width:${pctNormal}%;background:${dotColor};border-radius:3px;transition:width .4s"></div>
          </div>
        </div>
        <div class="c-depo-arrow">→</div>
      </div>`;
  }

  // Kritik liste — dashboard
  const dkList = document.getElementById('dash-kritik-list');
  if (dkList) {
    // Stok kritik + SKT yaklaşan malzemeleri birleştir
    const today = new Date(); today.setHours(0,0,0,0);
    const sktUyari = getAllItems().filter(i => {
      const mm = malzemeMeta[getKey(i.depo,i.ad)]||{};
      if (!mm.skt) return false;
      const diff = Math.round((new Date(mm.skt)-today)/86400000);
      return diff <= ayarlar.sktKritikGun;
    });
    const stokKritik = getAllItems().filter(i => {
      const s = getStok(i.depo, i.ad);
      return durum(s.mevcut, s.min, s.max) === 'Kritik';
    });
    // Birleştir ve tekrarları kaldır
    const seen = new Set();
    const kritikItems = [...stokKritik, ...sktUyari].filter(i => {
      const k = getKey(i.depo, i.ad);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, ayarlar.dashKritikLimit);
    if (kritikItems.length === 0) {
      dkList.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-lucide="check-circle"></i></div><div class="empty-title">Kritik stok yok</div><div class="empty-desc">Tüm malzemeler yeterli seviyede.</div></div>';
      if (window.lucide) lucide.createIcons({ nodes: [dkList] });
    } else {
      dkList.innerHTML = kritikItems.map(i => {
        const s = getStok(i.depo, i.ad);
        const _mm = malzemeMeta[getKey(i.depo,i.ad)]||{};
        const _sktD = _mm.skt ? sktDurum(_mm.skt) : null;
        const _icon = _sktD ? _sktD.icon : '⚠';
        const _depEsc = escQ(i.depo);
        const _adEsc  = escQ(i.ad);
        return `<div class="dash-kritik-item">
          <div class="dash-warn">${_icon}</div>
          <div style="flex:1;min-width:0">
            <div class="dash-kritik-ad">${esc(i.ad)}${_sktD?'<span class="skt-badge '+_sktD.cls+'" style="margin-left:6px">'+esc(_sktD.label)+'</span>':''}</div>
            <div class="dash-kritik-depo">${esc(i.depo)} · Mevcut: ${s.mevcut} / Min: ${s.min}</div>
          </div>
          <div class="dash-kritik-stok">${s.mevcut}/${s.min}</div>
          <button onclick="event.stopPropagation();hizliHareket('${_depEsc}','${_adEsc}','Giriş')"
            style="margin-left:8px;font-size:12px;padding:4px 9px;background:rgba(102,187,106,.12);border:1px solid rgba(102,187,106,.35);border-radius:6px;cursor:pointer;color:var(--green);font-weight:700;flex-shrink:0"
            title="Hızlı Giriş Kaydı">+ Giriş</button>
        </div>`;
      }).join('') + (getAllItems().filter(i=>{const s=getStok(i.depo,i.ad);return durum(s.mevcut,s.min,s.max)==='Kritik';}).length > 8
        ? `<div style="text-align:center;padding:10px 0;font-size:11px;color:var(--muted)">+ daha fazla kritik stok var →</div>` : '');
    }
  }

  // Son hareketler
  const sh = document.getElementById('son-hareketler');
  sh.innerHTML = hareketler.length === 0
    ? '<p style="color:var(--muted);font-size:13px;">Henüz hareket kaydı yok.</p>'
    : hareketler.slice(-ayarlar.sonHareketLimit).reverse().map(h => `
      <div class="hareket-item">
        <div class="hareket-dot ${h.tur==='Giriş'?'dot-giris':'dot-cikis'}">${h.tur==='Giriş'?'⬆':'⬇'}</div>
        <div class="hareket-info">
          <div class="hareket-mal">${esc(h.malzeme)}</div>
          <div class="hareket-meta">${depoBadge(h.depo)} · <span title="${esc(fmt(new Date(h.tarih)))}">${timeAgo(new Date(h.tarih))}</span>${h.personel?' · '+esc(h.personel):''}</div>
        </div>
        <div class="hareket-miktar ${h.tur==='Giriş'?'giris-clr':'cikis-clr'}">${h.tur==='Giriş'?'+':'−'}${h.miktar}</div>
      </div>`).join('');

  renderChartDepo();
  renderChartDurum('chartDurum');
}

function renderChartDepo() {
  const labels = Object.keys(DEPO_META);
  const data   = Object.keys(DEPO_META).map(d => getDepoItems(d).length);
  const colors = Object.values(DEPO_META).map(m => m.color);
  if (chartDepo) chartDepo.destroy();
  chartDepo = new Chart(document.getElementById('chartDepo'), {
    type:'bar',
    data:{labels,datasets:[{data,backgroundColor:colors,borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:true,grid:{color:'#dde4ec'}},x:{grid:{display:false}}}}
  });
}

function renderChartDurum(id) {
  let n=0, k=0, f=0;
  getAllItems().forEach(i => {
    const s = getStok(i.depo, i.ad);
    const d = durum(s.mevcut, s.min, s.max);
    if (d==='Normal') n++; else if (d==='Kritik') k++; else f++;
  });
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const existing = id==='chartDurum' ? chartDurum : chartDurum2;
  if (existing) existing.destroy();
  const ch = new Chart(canvas, {
    type:'doughnut',
    data:{labels:['Normal','Kritik','Fazla'],
      datasets:[{data:[n,k,f],backgroundColor:['#2e7d32','#d32f2f','#e65100'],borderWidth:0,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{legend:{position:'bottom',labels:{font:{family:'IBM Plex Sans',size:12},padding:12}}}}
  });
  if (id==='chartDurum') chartDurum=ch; else chartDurum2=ch;
}

// ═══════════════════════════════════════════════════════════════════
// STOK LİSTESİ
// ═══════════════════════════════════════════════════════════════════
function setDepoFilter(el, val, color) {
  document.querySelectorAll('.filter-chip[data-depo]').forEach(c => {
    c.classList.remove('active');
    c.style.borderColor = '';
    c.style.background  = '';
    c.style.color       = '';
  });
  el.classList.add('active');
  if (color && val !== 'Tümü') {
    el.style.borderColor = color;
    el.style.background  = color;
    el.style.color       = '#fff';
  }
  stokDepoFilter=val;stokSayfa=0;
  renderStok();
}
function initBirimSelects() {
  const opts = [...ayarlar.birimler,'Diğer'].map(b=>`<option value="${b}">${b}</option>`).join('');
  const sel = document.getElementById('yeni-birim');
  if (sel) sel.innerHTML = '<option value="">— Seçin —</option>' + opts;
}

function initKatSelects() {
  const kats = Object.keys(KAT_COLORS);
  const filterSel = document.getElementById('stok-kat-select');
  if (filterSel) filterSel.innerHTML = '<option value="Tümü">Tümü</option>'
    + kats.map(k => `<option value="${k}">${k}</option>`).join('');
  const inputSel = document.getElementById('yeni-kategori');
  if (inputSel) inputSel.innerHTML = '<option value="">— Seçin —</option>'
    + kats.map(k => `<option value="${k}">${k}</option>`).join('');
}

function initDepoSelects() {
  const depos = Object.keys(DEPO_META);
  const filterOpts = depos.map(d => `<option value="${d}">${d}</option>`).join('');
  ['har-depo-filter','talep-depo-filter','ekle-depo-filter'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = '<option value="">Tüm Depolar</option>' + filterOpts;
  });
  ['yeni-depo'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = '<option value="">-- Seçin --</option>' + filterOpts;
  });
  // Stok listesi depo filtre chip'lerini dinamik üret
  const wrap = document.getElementById('stok-depo-chips');
  if (wrap) {
    const aktifDepo = stokDepoFilter || 'Tümü';
    wrap.innerHTML =
      `<div class="filter-chip${aktifDepo==='Tümü'?' active':''}" data-depo="Tümü" onclick="setDepoFilter(this,'Tümü')">Tümü</div>` +
      depos.map(d => {
        const color = DEPO_META[d]?.color || 'var(--teal)';
        const aktif = aktifDepo === d;
        const style = aktif ? `--chip-color:${color};border-color:${color};background:${color};color:#fff` : '';
        return `<div class="filter-chip${aktif?' active':''}" data-depo="${esc(d)}" data-color="${color}" onclick="setDepoFilter(this,'${escQ(d)}','${color}')" style="${style}">${esc(d)}</div>`;
      }).join('');
  }
}

const KAT_COLORS={'Temizlik':{c:'#0277bd',bg:'#e3f2fd'},'Dezenfektan':{c:'#00838f',bg:'#e0f7fa'},'Kişisel Koruyucu':{c:'#2e7d32',bg:'#e8f5e9'},'Lab Malzeme':{c:'#6a1b9a',bg:'#f3e5f5'},'Cam Malzeme':{c:'#37474f',bg:'#eceff1'},'Kimyasal':{c:'#bf360c',bg:'#fbe9e7'},'Sarf Malzeme':{c:'#e65100',bg:'#fff3e0'},'Elektronik':{c:'#1565c0',bg:'#e3f2fd'},'Kırtasiye':{c:'#558b2f',bg:'#f1f8e9'},'Diğer':{c:'#546e7a',bg:'#eceff1'}};
function katBadgeHTML(kat){
  const cc=KAT_COLORS[kat]||{c:'#546e7a',bg:'#eceff1'};
  return '<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600;background:'+cc.bg+';color:'+cc.c+'">'+esc(kat)+'</span>';
}
function setKatFilter(el,val){
  document.querySelectorAll('.filter-chip[data-kat]').forEach(c=>c.classList.remove('active'));
  if(el&&el.classList)el.classList.add('active');
  stokKatFilter=val;stokSayfa=0;
  const sel=document.getElementById('stok-kat-select');
  if(sel)sel.value=val;
  renderStok();
}
function setKatFilterSel(val){
  stokKatFilter=val;stokSayfa=0;
  renderStok();
}
function setDurumFilter(el, val) {
  const was = el.classList.contains('active');
  document.querySelectorAll('.filter-chip[data-durum]').forEach(c=>c.classList.remove('active'));
  stokDurumFilter = was ? '' : val;
  if (!was) el.classList.add('active');
  stokSayfa=0;
  renderStok();
}

let stokSortKey = null;
let stokSortDir = 1;
let stokSayfa = 0;

function resetStokSort() {
  stokSortKey = null;
  stokSortDir = 1;
  ['ad','depo','kategori','mevcut','min','max','durum'].forEach(k => {
    const el = document.getElementById('sort-'+k);
    if (el) el.textContent = '';
  });
}

function stokSort(key) {
  if (stokSortKey === key) stokSortDir = -stokSortDir;
  else { stokSortKey = key; stokSortDir = 1; }
  renderStok();
}

const STOK_SUTUNLAR = [
  { key:'depo',     label:'Depo' },
  { key:'malzeme',  label:'Malzeme' },
  { key:'kategori', label:'Kategori' },
  { key:'mevcut',   label:'Mevcut' },
  { key:'birim',    label:'Birim' },
  { key:'min',      label:'Min' },
  { key:'max',      label:'Max' },
  { key:'durum',    label:'Durum' },
  { key:'doluluk',  label:'Doluluk' },
];

function stokSutunlariGetir() {
  const sirasi = (ayarlar.stokSutunSirasi && ayarlar.stokSutunSirasi.length)
    ? ayarlar.stokSutunSirasi
    : STOK_SUTUNLAR.map(s => s.key);
  const gizli = ayarlar.stokSutunGizli || [];
  // Sort by saved order, include any new keys at end
  const sorted = [];
  sirasi.forEach(k => { if (STOK_SUTUNLAR.find(s => s.key === k)) sorted.push(k); });
  STOK_SUTUNLAR.forEach(s => { if (!sorted.includes(s.key)) sorted.push(s.key); });
  return sorted.map(k => STOK_SUTUNLAR.find(s => s.key === k)).filter(s => s && !gizli.includes(s.key));
}

function renderStok(){
  const q=(document.getElementById('stok-search')?.value||'').toLowerCase();
  const tbl=document.getElementById('stok-tbody');

  let items = getAllItems().filter(item=>{
    if(stokDepoFilter!=='Tümü'&&item.depo!==stokDepoFilter) return false;
    if(stokKatFilter!=='Tümü'&&item.kategori!==stokKatFilter) return false;
    if(q&&!item.ad.toLowerCase().includes(q)&&!(item.kategori||'').toLowerCase().includes(q)) return false;
    const s=getStok(item.depo,item.ad);
    const d=durum(s.mevcut,s.min,s.max);
    if(stokDurumFilter&&d!==stokDurumFilter) return false;
    return true;
  });

  if (stokSortKey) {
    items.sort((a,b) => {
      let va, vb;
      const sa=getStok(a.depo,a.ad), sb=getStok(b.depo,b.ad);
      if (stokSortKey==='mevcut') { va=sa.mevcut; vb=sb.mevcut; }
      else if (stokSortKey==='min') { va=sa.min; vb=sb.min; }
      else if (stokSortKey==='max') { va=sa.max; vb=sb.max; }
      else if (stokSortKey==='durum') {
        const ord={Kritik:0,Normal:1,Fazla:2};
        va=ord[durum(sa.mevcut,sa.min,sa.max)];
        vb=ord[durum(sb.mevcut,sb.min,sb.max)];
      } else {
        va=(a[stokSortKey]||'').toLowerCase();
        vb=(b[stokSortKey]||'').toLowerCase();
      }
      return va<vb ? -stokSortDir : va>vb ? stokSortDir : 0;
    });
  }

  // ── KPI ──────────────────────────────────────────────────────────────────
  const tumItems = getAllItems().filter(item=>{
    if(stokDepoFilter!=='Tümü'&&item.depo!==stokDepoFilter) return false;
    if(stokKatFilter!=='Tümü'&&item.kategori!==stokKatFilter) return false;
    if(q&&!item.ad.toLowerCase().includes(q)&&!(item.kategori||'').toLowerCase().includes(q)) return false;
    return true;
  });
  let kpiToplam=0, kpiKritik=0, kpiNormal=0, kpiFazla=0;
  tumItems.forEach(item=>{
    const s=getStok(item.depo,item.ad); const d=durum(s.mevcut,s.min,s.max);
    kpiToplam++; if(d==='Kritik')kpiKritik++; else if(d==='Fazla')kpiFazla++; else kpiNormal++;
  });
  const kpiEl = document.getElementById('stok-kpi');
  if (kpiEl) {
    const kpiAktif = (cls) => stokDurumFilter===cls?' kpi-aktif':'';
    kpiEl.innerHTML = `
      <div class="kpi-kart" onclick="stokDurumFilter='';stokSayfa=0;renderStok()">
        <div class="kpi-sayi">${kpiToplam}</div><div class="kpi-lbl">Toplam</div>
      </div>
      <div class="kpi-kart kpi-kritik${kpiAktif('Kritik')}" onclick="stokDurumFilter=stokDurumFilter==='Kritik'?'':'Kritik';stokSayfa=0;renderStok()">
        <div class="kpi-sayi">${kpiKritik}</div><div class="kpi-lbl"><i data-lucide="alert-triangle" class="icon-inline"></i> Kritik</div>
      </div>
      <div class="kpi-kart kpi-normal${kpiAktif('Normal')}" onclick="stokDurumFilter=stokDurumFilter==='Normal'?'':'Normal';stokSayfa=0;renderStok()">
        <div class="kpi-sayi">${kpiNormal}</div><div class="kpi-lbl"><i data-lucide="check-circle" class="icon-inline"></i> Normal</div>
      </div>
      <div class="kpi-kart kpi-fazla${kpiAktif('Fazla')}" onclick="stokDurumFilter=stokDurumFilter==='Fazla'?'':'Fazla';stokSayfa=0;renderStok()">
        <div class="kpi-sayi">${kpiFazla}</div><div class="kpi-lbl"><i data-lucide="trending-up" class="icon-inline"></i> Fazla</div>
      </div>`;
    if (window.lucide) lucide.createIcons({ nodes: [kpiEl] });
  }

  // ── Aktif filtreler ───────────────────────────────────────────────────────
  const afEl = document.getElementById('stok-aktif-filtreler');
  if (afEl) {
    const chips = [];
    if (stokDepoFilter !== 'Tümü') chips.push(`<span class="af-chip">Depo: <strong>${esc(stokDepoFilter)}</strong><button onclick="stokDepoFilter='Tümü';document.querySelectorAll('.filter-chip[data-depo]').forEach(c=>{c.classList.remove('active');c.style.cssText=''});document.querySelector('.filter-chip[data-depo=\\'Tümü\\']')?.classList.add('active');stokSayfa=0;renderStok()">×</button></span>`);
    if (stokKatFilter !== 'Tümü') chips.push(`<span class="af-chip">Kategori: <strong>${esc(stokKatFilter)}</strong><button onclick="stokKatFilter='Tümü';const sel=document.getElementById('stok-kat-select');if(sel)sel.value='Tümü';stokSayfa=0;renderStok()">×</button></span>`);
    if (stokDurumFilter) chips.push(`<span class="af-chip">Durum: <strong>${esc(stokDurumFilter)}</strong><button onclick="stokDurumFilter='';stokSayfa=0;renderStok()">×</button></span>`);
    if (q) chips.push(`<span class="af-chip">Arama: <strong>${esc(q)}</strong><button onclick="const si=document.getElementById('stok-search');if(si){si.value='';document.getElementById('stok-search-clear').style.display='none';}stokSayfa=0;renderStok()">×</button></span>`);
    if (chips.length > 0) {
      afEl.innerHTML = chips.join('') + `<button class="af-temizle" onclick="stokDepoFilter='Tümü';stokKatFilter='Tümü';stokDurumFilter='';const si=document.getElementById('stok-search');if(si){si.value='';document.getElementById('stok-search-clear').style.display='none';}document.querySelectorAll('.filter-chip').forEach(c=>{c.classList.remove('active');c.style.cssText=''});document.querySelector('.filter-chip[data-depo=\\'Tümü\\']')?.classList.add('active');const sel=document.getElementById('stok-kat-select');if(sel)sel.value='Tümü';stokSayfa=0;renderStok()"><i data-lucide='x' class='icon-inline'></i> Tümünü Temizle</button>`;
      afEl.style.display = 'flex';
      if (window.lucide) lucide.createIcons({ nodes: [afEl] });
    } else {
      afEl.style.display = 'none';
    }
  }

  // Sayfalama hesapla
  const toplamKalem = items.length;
  const toplamSayfa = Math.max(1, Math.ceil(toplamKalem / ayarlar.stokSayfaBoy));
  if (stokSayfa >= toplamSayfa) stokSayfa = toplamSayfa - 1;
  const baslangic = stokSayfa * ayarlar.stokSayfaBoy;
  const sayfa_items = items.slice(baslangic, baslangic + ayarlar.stokSayfaBoy);

  const gorunenSutunlar = stokSutunlariGetir();
  const colCount = gorunenSutunlar.length + 2; // # + dinamik + İşlem

  // Rebuild thead dynamically
  const thead = document.querySelector('#stok-table thead tr');
  if (thead) {
    // ── Sıralama ikonları: aktif sütunda chevron, diğerlerinde soluk çift ok ──
    const sortIconFor = (sortKey) => {
      if (stokSortKey === sortKey) {
        return stokSortDir === 1
          ? ' <i data-lucide="chevron-up" class="sort-icon sort-icon-aktif"></i>'
          : ' <i data-lucide="chevron-down" class="sort-icon sort-icon-aktif"></i>';
      }
      return ' <i data-lucide="chevrons-up-down" class="sort-icon sort-icon-pasif"></i>';
    };
    thead.innerHTML = '<th>#</th>'
      + gorunenSutunlar.map(col => {
          const isSortable = ['malzeme','depo','kategori','mevcut','min','max','durum'].includes(col.key);
          const sortKey = col.key === 'malzeme' ? 'ad' : col.key;
          if (isSortable) {
            return `<th class="sortable stok-th-drag" draggable="true" data-col="${col.key}" onclick="stokSort('${sortKey}')">${col.label}${sortIconFor(sortKey)}</th>`;
          }
          return `<th class="stok-th-drag" draggable="true" data-col="${col.key}">${col.label}</th>`;
        }).join('')
      + '<th data-col="islem">İşlem</th>';
    if (window.lucide) lucide.createIcons({ nodes: [thead] });
  }

  // Arama vurgulama yardımcısı
  const vurgula = (txt) => {
    if (!q) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if (idx === -1) return esc(txt);
    return esc(txt.slice(0, idx)) + '<mark class="stok-vurgu">' + esc(txt.slice(idx, idx + q.length)) + '</mark>' + esc(txt.slice(idx + q.length));
  };

  let rows='';
  sayfa_items.forEach((item, i)=>{
    const s=getStok(item.depo,item.ad);
    const d=durum(s.mevcut,s.min,s.max);
    const idx = baslangic + i + 1;
    const pct=s.max>0?Math.min(100,Math.round((s.mevcut/s.max)*100)):0;
    const minPct=s.max>0?Math.min(100,Math.round((s.min/s.max)*100)):0;
    const fc=d==='Kritik'?'fill-kritik':d==='Fazla'?'fill-fazla':'fill-normal';
    const key=escKey(item.depo,item.ad);
    const katCell=item.kategori?katBadgeHTML(item.kategori):'<span style="font-size:11px;color:var(--muted)">—</span>';
    const birCell=item.birim?esc(item.birim):'<span style="color:var(--muted)">—</span>';
    const rowCls = d==='Kritik' ? 'row-kritik' : d==='Fazla' ? 'row-fazla' : '';
    const _mh2=hareketler.filter(h=>h.depo===item.depo&&h.malzeme===item.ad);

    let dynamicCells = '';
    gorunenSutunlar.forEach(col => {
      switch(col.key) {
        case 'depo':
          dynamicCells += '<td data-col="depo" data-label="Depo">'+depoBadge(item.depo)+'</td>';
          break;
        case 'malzeme': {
          const meta = malzemeMeta[getKey(item.depo,item.ad)]||{};
          dynamicCells += '<td class="td-name" data-col="malzeme" data-label="Malzeme">'
            +'<div>'+vurgula(item.ad)+(item.ozel?'<span style="font-size:10px;color:var(--teal);margin-left:6px">★</span>':'')+'</div>'
            +(meta.marka?'<div><span class="marka-badge">'+esc(meta.marka)+'</span></div>':'')
            +(meta.skt?'<div>'+sktBadge(meta.skt)+'</div>':'')
            +'</td>';
          break;
        }
        case 'kategori':
          dynamicCells += '<td data-col="kategori" data-label="Kategori">'+katCell+'</td>';
          break;
        case 'mevcut':
          dynamicCells += '<td class="td-mono" data-col="mevcut" data-label="Mevcut" style="font-weight:700;color:'+(d==='Kritik'?'var(--red)':d==='Fazla'?'var(--amber)':'var(--blue)')+'">'+s.mevcut+'</td>';
          break;
        case 'birim':
          dynamicCells += '<td class="td-mono" data-col="birim" data-label="Birim" style="color:var(--muted)">'+birCell+'</td>';
          break;
        case 'min':
          dynamicCells += '<td class="td-mono" data-col="min" data-label="Min">'+s.min+'</td>';
          break;
        case 'max':
          dynamicCells += '<td class="td-mono" data-col="max" data-label="Max">'+s.max+'</td>';
          break;
        case 'durum':
          dynamicCells += '<td data-col="durum" data-label="Durum">'+durumBadge(d)+'</td>';
          break;
        case 'doluluk': {
          const tickHtml = (s.max>0 && s.min>0)
            ? `<div class="stok-bar-tick" style="left:${minPct}%" title="Min: ${s.min}"></div>`
            : '';
          dynamicCells += `<td data-col="doluluk" data-label="Doluluk"><div class="stok-bar-wrap"><div class="stok-bar"><div class="stok-bar-fill ${fc}" style="width:${pct}%"></div>${tickHtml}</div><span class="stok-num">${pct}%</span></div></td>`;
          break;
        }
      }
    });

    const _depQ = escQ(item.depo);
    const _adQ  = escQ(item.ad);
    const logBtn = _mh2.length>0
      ? `<button class="islem-btn islem-btn-log" onclick="openMalHareket('${_depQ}','${_adQ}')" title="Hareket geçmişi (${_mh2.length})"><i data-lucide="history"></i><span class="islem-badge">${_mh2.length}</span></button>`
      : '';
    rows+='<tr class="'+rowCls+'">'
      +'<td class="td-mono" data-label="#">'+idx+'</td>'
      +dynamicCells
      +`<td data-col="islem" data-label="İşlem"><div class="islem-grup">`
      +logBtn
      +`<button class="islem-btn islem-btn-in" onclick="hizliHareket('${_depQ}','${_adQ}','Giriş')" title="Hızlı Giriş"><i data-lucide="plus-circle"></i></button>`
      +`<button class="islem-btn islem-btn-out" onclick="hizliHareket('${_depQ}','${_adQ}','Çıkış')" title="Hızlı Çıkış"><i data-lucide="minus-circle"></i></button>`
      +`<button class="islem-btn islem-btn-edit" onclick="openStokModal('${key}','${_depQ}','${_adQ}')" title="Düzenle"><i data-lucide="pencil"></i></button>`
      +`</div></td>`
      +'</tr>';
  });

  const emptyState = `<tr><td colspan="${colCount}" style="padding:0">
    <div class="empty-state">
      <div class="empty-icon"><i data-lucide="search-x"></i></div>
      <div class="empty-title">Sonuç bulunamadı</div>
      <div class="empty-desc">Arama veya filtre kriterlerinizi değiştirin.</div>
      <button class="btn btn-outline btn-sm" style="margin-top:12px" onclick="stokDepoFilter='Tümü';stokKatFilter='Tümü';stokDurumFilter='';const si=document.getElementById('stok-search');if(si){si.value='';document.getElementById('stok-search-clear').style.display='none';}stokSayfa=0;renderStok()"><i data-lucide='x' class='icon-inline'></i> Filtreleri Temizle</button>
    </div>
  </td></tr>`;
  tbl.innerHTML = rows || emptyState;
  if (window.lucide) lucide.createIcons({ nodes: [tbl] });

  // Sayfalama kontrolleri
  const spEl = document.getElementById('stok-sayfalama');
  if (spEl) {
    if (toplamSayfa <= 1) { spEl.innerHTML = `<span style="font-size:11px;color:var(--muted)">${toplamKalem} kalem</span>`; }
    else {
      const goster = 2; // aktif sayfanın her iki yanında gösterilecek sayfa sayısı
      let btns = `<span style="font-size:11px;color:var(--muted)">${toplamKalem} kalem</span>`;
      btns += `<div style="display:flex;gap:4px;align-items:center">`;
      btns += `<button class="sayfa-btn" onclick="stokSayfa--;renderStok()" ${stokSayfa===0?'disabled':''}>‹</button>`;
      for (let p = 0; p < toplamSayfa; p++) {
        if (p === 0 || p === toplamSayfa-1 || Math.abs(p - stokSayfa) <= goster) {
          btns += `<button class="sayfa-btn ${p===stokSayfa?'aktif':''}" onclick="stokSayfa=${p};renderStok()">${p+1}</button>`;
        } else if (Math.abs(p - stokSayfa) === goster+1) {
          btns += `<span style="color:var(--muted);font-size:12px;padding:0 2px">…</span>`;
        }
      }
      btns += `<button class="sayfa-btn" onclick="stokSayfa++;renderStok()" ${stokSayfa===toplamSayfa-1?'disabled':''}>›</button>`;
      btns += `</div>`;
      spEl.innerHTML = btns;
    }
  }


  _updateStokTableHeight();
  initStokSutunDrag();
  renderStokSutunMenu();
}

function _updateStokTableHeight() {
  requestAnimationFrame(() => {
    const wrapper = document.querySelector('#page-stok .table-wrapper');
    const toolbar = document.querySelector('.stok-toolbar-sticky');
    const pagination = document.getElementById('stok-sayfalama');
    if (!wrapper || !toolbar) return;
    const topbar = 52;
    const toolbarH = toolbar.offsetHeight;
    const paginationH = pagination ? pagination.offsetHeight : 50;
    const contentPadding = 40;
    wrapper.style.maxHeight = (window.innerHeight - topbar - toolbarH - paginationH - contentPadding) + 'px';
  });
}
// Pencere boyutu değişince yüksekliği güncelle
window.addEventListener('resize', _updateStokTableHeight);

function initStokSutunDrag() {
  const thead = document.querySelector('#stok-table thead');
  if (!thead || thead._dragInited) return;
  thead._dragInited = true;

  let dragSrc = null;

  thead.addEventListener('dragstart', e => {
    const th = e.target.closest('.stok-th-drag');
    if (!th) return;
    dragSrc = th;
    th.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  thead.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('dragging');
    thead.querySelectorAll('.stok-th-drag').forEach(t => t.classList.remove('drag-over'));
    dragSrc = null;
  });
  thead.addEventListener('dragover', e => {
    e.preventDefault();
    const th = e.target.closest('.stok-th-drag');
    thead.querySelectorAll('.stok-th-drag').forEach(t => t.classList.remove('drag-over'));
    if (th && th !== dragSrc) th.classList.add('drag-over');
  });
  thead.addEventListener('drop', e => {
    e.preventDefault();
    const th = e.target.closest('.stok-th-drag');
    if (!dragSrc || !th || dragSrc === th) return;
    const srcKey = dragSrc.dataset.col;
    const dstKey = th.dataset.col;
    const sirasi = (ayarlar.stokSutunSirasi && ayarlar.stokSutunSirasi.length)
      ? [...ayarlar.stokSutunSirasi]
      : STOK_SUTUNLAR.map(s => s.key);
    const si = sirasi.indexOf(srcKey);
    const di = sirasi.indexOf(dstKey);
    if (si !== -1 && di !== -1) {
      sirasi.splice(si, 1);
      sirasi.splice(di, 0, srcKey);
      ayarlar.stokSutunSirasi = sirasi;
      ayarlariKaydet();
      renderStok();
    }
  });
}

function renderStokSutunMenu() {
  const btn = document.getElementById('stok-sutun-btn');
  if (!btn) return;
  const menu = document.getElementById('stok-sutun-menu');
  if (!menu) return;
  const gizli = ayarlar.stokSutunGizli || [];
  menu.innerHTML = STOK_SUTUNLAR.map(s => `
    <label class="sutun-menu-item">
      <input type="checkbox" ${gizli.includes(s.key) ? '' : 'checked'}
        onchange="toggleStokSutun('${s.key}',this.checked)">
      ${s.label}
    </label>
  `).join('');
}

function toggleStokSutun(key, visible) {
  let gizli = [...(ayarlar.stokSutunGizli || [])];
  if (visible) gizli = gizli.filter(k => k !== key);
  else if (!gizli.includes(key)) gizli.push(key);
  ayarlar.stokSutunGizli = gizli;
  ayarlariKaydet();
  renderStok();
}

function escKey(dep, mal) { return (dep+'||'+mal).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// onclick="fn('${escQ(x)}')" gibi inline handler'larda güvenli (önce JS-string, sonra HTML-attr kaçışı)
function escQ(s) { return String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r?\n/g,'\\n'); }

function openStokModal(_key, dep, mal) {
  editKey = {dep, mal};
  const s = getStok(dep, mal);
  const mm=malzemeMeta[getKey(dep,mal)]||{};
  const _birList=[...ayarlar.birimler,'Diğer'];
  const _bo=_birList.map(b=>'<option value="'+b+'"'+(mm.birim===b||(!_birList.includes(mm.birim)&&mm.birim&&b==='Diğer')?' selected':'')+'>'+b+'</option>').join('');
  const _birDiğerVal = (_birList.includes(mm.birim)||!mm.birim) ? '' : mm.birim;
  const _katList=Object.keys(KAT_COLORS);
  const _ko=_katList.map(k=>'<option value="'+k+'"'+(mm.kategori===k||(!_katList.includes(mm.kategori)&&mm.kategori&&k==='Diğer')?' selected':'')+'>'+k+'</option>').join('');
  const _katDiğerVal = (_katList.includes(mm.kategori)||!mm.kategori) ? '' : mm.kategori;
  document.getElementById('modal-stok-icerik').innerHTML=
    '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">'+dep+'</p>'
    +'<div class="form-grid">'
    +'<div class="form-group" style="grid-column:1/-1">'
    +'<label>Malzeme Adı</label>'
    +'<input type="text" id="m-ad" value="'+mal.replace(/"/g,'&quot;')+'" style="font-weight:600">'
    +'<input type="text" id="m-marka" value="'+(mm.marka||'').replace(/"/g,'&quot;')+'" placeholder="Marka (opsiyonel)" style="margin-top:5px;font-size:11px;color:var(--muted);border-color:var(--line)">'
    +'</div>'
    +'<div class="form-group"><label>Mevcut Stok</label><input type="number" id="m-mevcut" value="'+s.mevcut+'" min="0"></div>'
    +'<div class="form-group"><label>Min Stok</label><input type="number" id="m-min" value="'+s.min+'" min="0"></div>'
    +'<div class="form-group"><label>Max Stok</label><input type="number" id="m-max" value="'+s.max+'" min="0"></div>'
    +'<div class="form-group"><label>Birim</label>'
    +'<select id="m-birim" onchange="handleDiger(this,\'m-birim-diger\')"><option value="">— Seçin —</option>'+_bo+'</select>'
    +'<div id="m-birim-diger-wrap" style="display:'+(_birDiğerVal?'block':'none')+';margin-top:5px">'
    +'<input type="text" id="m-birim-diger" value="'+_birDiğerVal+'" placeholder="Birim girin..." style="font-size:12px"></div></div>'
    +'<div class="form-group"><label>Kategori</label>'
    +'<select id="m-kategori" onchange="handleDiger(this,\'m-kategori-diger\')"><option value="">— Seçin —</option>'+_ko+'</select>'
    +'<div id="m-kategori-diger-wrap" style="display:'+(_katDiğerVal?'block':'none')+';margin-top:5px">'
    +'<input type="text" id="m-kategori-diger" value="'+_katDiğerVal+'" placeholder="Kategori girin..." style="font-size:12px"></div></div>'
    +(dep==='Kimyasal Deposu'?'<div class="form-group" style="grid-column:1/-1"><label>☠ Son Kullanma Tarihi</label><input type="date" id="m-skt" value="'+(mm.skt||'')+'" style="font-family:IBM Plex Mono,monospace"></div>':'')
    +'</div>';
  document.getElementById('modal-stok').classList.add('open');
}

function saveStok() {
  if (!editKey) return;
  const yeniAd = (document.getElementById('m-ad')?.value||'').trim();
  const mevcut = parseInt(document.getElementById('m-mevcut').value)||0;
  const min    = parseInt(document.getElementById('m-min').value)||0;
  const max    = parseInt(document.getElementById('m-max').value)||0;
  if (!yeniAd) { toast('Malzeme adı boş olamaz!','error'); return; }
  const eskiAd = editKey.mal;
  const dep    = editKey.dep;
  const eskiKey= getKey(dep, eskiAd);
  const yeniKey= getKey(dep, yeniAd);
  // Stok verisini taşı
  stok[yeniKey]={mevcut,min,max};
  if (yeniKey!==eskiKey) { delete stok[eskiKey]; }
  // Meta verisini taşı
  if(!malzemeMeta[yeniKey])malzemeMeta[yeniKey]={};
  malzemeMeta[yeniKey].birim    = getDigerVal('m-birim','m-birim-diger');
  malzemeMeta[yeniKey].kategori = getDigerVal('m-kategori','m-kategori-diger');
  malzemeMeta[yeniKey].marka    = (document.getElementById('m-marka')?.value||'').trim();
  const _sktEl = document.getElementById('m-skt');
  if (_sktEl) malzemeMeta[yeniKey].skt = _sktEl.value || null;
  if (yeniKey!==eskiKey) { delete malzemeMeta[eskiKey]; }
  // Özel malzeme adını güncelle
  if (ozelMalzeme[eskiKey]) {
    ozelMalzeme[yeniKey] = {...ozelMalzeme[eskiKey], ad: yeniAd};
    if (yeniKey!==eskiKey) delete ozelMalzeme[eskiKey];
  } else if (yeniKey!==eskiKey) {
    // Kaynak malzeme yeniden adlandırıldı: silinmiş olarak işaretle, özel olarak ekle
    silinmis[eskiKey]=true;
    const srcItem = (KAYNAK[dep]||[]).find(i=>i.ad===eskiAd);
    ozelMalzeme[yeniKey]={ad:yeniAd, sayim:srcItem?.sayim||'—', depo:dep,
      birim:malzemeMeta[yeniKey]?.birim||'', kategori:malzemeMeta[yeniKey]?.kategori||''};
  }
  // Hareket geçmişinde adı güncelle
  if (yeniKey!==eskiKey) {
    hareketler.forEach(h=>{ if(h.depo===dep&&h.malzeme===eskiAd) h.malzeme=yeniAd; });
  }
  editKey.mal = yeniAd;
  closeModal('modal-stok');refreshAll();
  toast(yeniKey!==eskiKey ? '"'+yeniAd+'" olarak güncellendi.' : 'Stok güncellendi.');
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ═══════════════════════════════════════════════════════════════════
// GİRİŞ / ÇIKIŞ
// ═══════════════════════════════════════════════════════════════════
function filterMalzemeList() {
  const dep = document.getElementById('h-depo').value;
  const sel = document.getElementById('h-malzeme');
  if (!dep) { sel.innerHTML='<option>-- Önce depo seçin --</option>'; return; }
  sel.innerHTML = getDepoItems(dep).map(i=>{
    const s = getStok(dep, i.ad);
    const d = durum(s.mevcut, s.min, s.max);
    const flag = d==='Kritik' ? ' ⚠ kritik' : d==='Fazla' ? ' ↑ fazla' : '';
    const mm = malzemeMeta[getKey(dep,i.ad)]||{};
    const bir = mm.birim ? ` [${mm.birim}]` : '';
    return `<option value="${i.ad}">${i.ad}${bir} — ${s.mevcut} mevcut${flag}</option>`;
  }).join('') || '<option>Bu depoda malzeme yok</option>';
  // Seçili malzemenin stok bilgisini göster
  updateHareketStokBilgi();
}

function updateHareketStokBilgi() {
  const dep = document.getElementById('h-depo')?.value;
  const mal = document.getElementById('h-malzeme')?.value;
  const infoEl = document.getElementById('h-stok-bilgi');
  if (!infoEl) return;
  if (!dep || !mal) { infoEl.style.display='none'; return; }
  const s = getStok(dep, mal);
  const d = durum(s.mevcut, s.min, s.max);
  const color = d==='Kritik' ? 'var(--red)' : d==='Fazla' ? 'var(--amber)' : 'var(--teal)';
  const mm = malzemeMeta[getKey(dep,mal)]||{};
  infoEl.style.display = 'flex';
  infoEl.innerHTML = `
    <span style="font-size:11px;color:var(--muted)">Mevcut:</span>
    <strong style="font-size:14px;color:${color};font-family:'IBM Plex Mono',monospace">${s.mevcut}${mm.birim?' '+mm.birim:''}</strong>
    <span style="font-size:11px;color:var(--muted)">Min: ${s.min} / Max: ${s.max}</span>
    <span style="margin-left:auto">${durumBadge(d)}</span>`;
}

function setHarTarihShortcut(mod) {
  const today = new Date(); today.setHours(0,0,0,0);
  let bas, bit = today.toISOString().slice(0,10);
  if (mod === 'bugun') {
    bas = bit;
  } else if (mod === 'hafta') {
    const d = new Date(today); d.setDate(today.getDate() - ((today.getDay()||7) - 1));
    bas = d.toISOString().slice(0,10);
  } else if (mod === 'ay') {
    bas = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
  }
  harTarihBas = bas; harTarihBit = bit;
  document.getElementById('har-tarih-bas').value = bas;
  document.getElementById('har-tarih-bit').value = bit;
  document.querySelectorAll('.har-tarih-chip').forEach(c => c.classList.remove('active'));
  document.querySelector(`.har-tarih-chip[data-mod="${mod}"]`)?.classList.add('active');
  harSayfa = 0; renderHareketList();
}

function setHarFilter(el, val) {
  document.querySelectorAll('.filter-chip[data-htur]').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  harFilter = val;
  renderHareketList();
}

let _harEklenenler = [];

function _harEkle() {
  const dep = document.getElementById('h-depo').value;
  const mal = document.getElementById('h-malzeme').value;
  const tur = document.getElementById('h-tur').value;
  const mik = parseInt(document.getElementById('h-miktar').value);
  if (!dep || !mal) { toast('Malzeme seçin', 'error'); return; }
  if (!mik || mik <= 0) { toast('Geçerli miktar girin', 'error'); return; }
  _harEklenenler.push({ dep, mal, tur, mik });
  _renderHarEklenenler();
  _harMalTemizle();
  document.getElementById('h-miktar').value = '';
  document.getElementById('h-ekle-satir').style.display = 'none';
  document.getElementById('h-mal-search').focus();
}

function _harEklenenSil(idx) {
  _harEklenenler.splice(idx, 1);
  _renderHarEklenenler();
}

function _renderHarEklenenler() {
  const wrap = document.getElementById('h-eklenenler-wrap');
  const list = document.getElementById('h-eklenenler-list');
  const sayi = document.getElementById('h-eklenen-sayi');
  if (!wrap || !list) return;
  if (!_harEklenenler.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (sayi) sayi.textContent = _harEklenenler.length;
  list.innerHTML = _harEklenenler.map((h, i) => `
    <div class="h-eklenen-item">
      <div class="h-eklenen-info">
        <span class="h-eklenen-ad">${esc(h.mal)}</span>
        ${depoBadge(h.dep)}
      </div>
      <div class="h-eklenen-sag">
        <span class="h-eklenen-tur ${h.tur==='Giriş'?'giris-clr':'cikis-clr'}">${h.tur==='Giriş'?'+':'−'}${h.mik}</span>
        <button class="har-sil-btn" onclick="_harEklenenSil(${i})" title="Kaldır">×</button>
      </div>
    </div>`).join('');
}

function kaydetHareket() {
  if (!_harEklenenler.length) { toast('En az 1 malzeme ekleyin', 'error'); return; }
  const belge = document.getElementById('h-belge').value;
  const pers  = document.getElementById('h-personel').value;
  const not   = document.getElementById('h-not').value;
  if ((notZorunlu || ayarlar.hareketNot) && !not.trim()) { toast('Not alanı zorunlu!', 'error'); document.getElementById('h-not')?.focus(); return; }
  for (const h of _harEklenenler) {
    const s = getStok(h.dep, h.mal);
    if (h.tur === 'Çıkış' && s.mevcut < h.mik) {
      toast(`Yetersiz stok: ${h.mal} (Mevcut: ${s.mevcut})`, 'error'); return;
    }
  }
  const now = new Date().toISOString();
  _harEklenenler.forEach(h => {
    const s = getStok(h.dep, h.mal);
    s.mevcut = h.tur === 'Giriş' ? s.mevcut + h.mik : s.mevcut - h.mik;
    hareketler.push({ id: Date.now()+'-'+Math.random().toString(36).slice(2,7),
      tarih: now, depo: h.dep, malzeme: h.mal, tur: h.tur, miktar: h.mik, belge, personel: pers, not });
  });
  const n = _harEklenenler.length;
  clearHareketForm();
  renderHareketList();
  refreshAll();
  toast(`${n} hareket kaydedildi ✓`);
}

function clearHareketForm() {
  ['h-belge','h-personel','h-not'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('h-miktar').value = '';
  document.getElementById('h-ekle-satir').style.display = 'none';
  _harEklenenler = [];
  _renderHarEklenenler();
  _harMalTemizle();
}

function _harMalAra(q) {
  const dd = document.getElementById('h-mal-dropdown');
  const cl = document.getElementById('h-mal-clear');
  if (cl) cl.style.display = q ? 'flex' : 'none';
  document.getElementById('h-depo').value = '';
  document.getElementById('h-malzeme').value = '';
  document.getElementById('h-stok-bilgi').style.display = 'none';
  if (!q.trim()) { dd.innerHTML = ''; dd.classList.remove('open'); return; }
  const ql = q.toLowerCase();
  const results = getAllItems().filter(i =>
    i.ad.toLowerCase().includes(ql) || i.depo.toLowerCase().includes(ql)
  ).slice(0, 25);
  if (!results.length) {
    dd.innerHTML = '<div class="h-mal-empty">Sonuç bulunamadı</div>';
    dd.classList.add('open'); return;
  }
  dd.innerHTML = results.map(i => {
    const s = getStok(i.depo, i.ad);
    const d = durum(s.mevcut, s.min, s.max);
    const dc = d==='Kritik' ? 'var(--red)' : d==='Fazla' ? 'var(--amber)' : 'var(--green)';
    return `<div class="h-mal-item" onclick="_harMalSec('${escQ(i.depo)}','${escQ(i.ad)}')">
      <div class="h-mal-item-ad">${esc(i.ad)}</div>
      <div class="h-mal-item-meta">${depoBadge(i.depo)}<span class="h-mal-mevcut" style="color:${dc}">${s.mevcut} mevcut</span></div>
    </div>`;
  }).join('');
  dd.classList.add('open');
}

function _harMalSec(dep, mal) {
  document.getElementById('h-depo').value    = dep;
  document.getElementById('h-malzeme').value = mal;
  document.getElementById('h-mal-search').value = mal;
  document.getElementById('h-mal-clear').style.display = 'flex';
  const dd = document.getElementById('h-mal-dropdown');
  dd.innerHTML = ''; dd.classList.remove('open');
  document.getElementById('h-ekle-satir').style.display = 'block';
  updateHareketStokBilgi();
  document.getElementById('h-miktar')?.focus();
}

function _harMalTemizle() {
  const s = document.getElementById('h-mal-search');
  const c = document.getElementById('h-mal-clear');
  const d = document.getElementById('h-mal-dropdown');
  if (s) s.value = '';
  if (c) c.style.display = 'none';
  if (d) { d.innerHTML = ''; d.classList.remove('open'); }
  document.getElementById('h-depo').value = '';
  document.getElementById('h-malzeme').value = '';
  document.getElementById('h-stok-bilgi').style.display = 'none';
}

// FIX: Hareket silme + stok geri alma
function hareketSil(id) {
  const idx = hareketler.findIndex(h=>h.id===id);
  if (idx===-1) return;
  const h = hareketler[idx];
  if (!confirm(`"${h.malzeme}" hareketini silmek istediğinizden emin misiniz?\n${h.tur} · ${h.miktar} adet · ${new Date(h.tarih).toLocaleDateString("tr-TR")}\nStok geri alınacak.`)) return;
  const s = getStok(h.depo, h.malzeme);
  // Ters işlem
  s.mevcut = h.tur==='Giriş' ? s.mevcut-h.miktar : s.mevcut+h.miktar;
  if (s.mevcut < 0) s.mevcut = 0;
  hareketler.splice(idx, 1);
  renderHareketList();
  refreshAll();
  toast('Hareket silindi, stok güncellendi.');
}

function renderHareketList() {
  const q      = (document.getElementById('har-search')?.value||'').toLowerCase();
  const list   = document.getElementById('hareket-list');
  const spEl   = document.getElementById('har-sayfalama');
  const ozEl   = document.getElementById('har-ozet');
  if (!list) return;

  // Filtrele
  const filtered = hareketler.filter(h => {
    if (harFilter !== 'Tümü' && h.tur !== harFilter) return false;
    if (harDepoFilter && h.depo !== harDepoFilter) return false;
    if (harPersonelFilter && !(h.personel||'').toLowerCase().includes(harPersonelFilter.toLowerCase())) return false;
    if (q && !h.malzeme.toLowerCase().includes(q) && !h.depo.toLowerCase().includes(q) &&
        !(h.personel||'').toLowerCase().includes(q) && !(h.belge||'').toLowerCase().includes(q)) return false;
    if (harTarihBas) {
      const hd = new Date(h.tarih); hd.setHours(0,0,0,0);
      if (hd < new Date(harTarihBas + 'T00:00:00')) return false;
    }
    if (harTarihBit) {
      const hd = new Date(h.tarih); hd.setHours(0,0,0,0);
      if (hd > new Date(harTarihBit + 'T00:00:00')) return false;
    }
    return true;
  }).slice().reverse();

  // ── Özet kartlar ──────────────────────────────────────────────
  if (ozEl) {
    const today = new Date().toDateString();
    const bugunGiris  = hareketler.filter(h => h.tur==='Giriş'  && new Date(h.tarih).toDateString()===today).length;
    const bugunCikis  = hareketler.filter(h => h.tur==='Çıkış'  && new Date(h.tarih).toDateString()===today).length;
    const toplam      = hareketler.length;
    // En aktif malzeme
    const malSay = {};
    hareketler.forEach(h => { malSay[h.malzeme] = (malSay[h.malzeme]||0)+1; });
    const enAktif = Object.entries(malSay).sort((a,b)=>b[1]-a[1])[0];
    ozEl.innerHTML = `
      <div class="har-ozet-kart"><div class="har-ozet-sayi har-sayi-giris">${bugunGiris}</div><div class="har-ozet-lbl">Bugün Giriş</div></div>
      <div class="har-ozet-kart"><div class="har-ozet-sayi har-sayi-cikis">${bugunCikis}</div><div class="har-ozet-lbl">Bugün Çıkış</div></div>
      <div class="har-ozet-kart"><div class="har-ozet-sayi har-sayi-toplam">${toplam}</div><div class="har-ozet-lbl">Toplam Hareket</div></div>
      <div class="har-ozet-kart"><div class="har-ozet-sayi har-sayi-aktif">${enAktif?esc(enAktif[0].slice(0,18)):'—'}</div><div class="har-ozet-lbl">En Aktif Malzeme</div></div>`;
  }

  // ── Boş durum ─────────────────────────────────────────────────
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-lucide="search-x"></i></div><div class="empty-title">Sonuç bulunamadı</div><div class="empty-desc">Farklı bir arama veya filtre deneyin.</div></div>';
    if (window.lucide) lucide.createIcons({ nodes: [list] });
    if (spEl) spEl.innerHTML = '';
    return;
  }

  // ── Sayfalama ─────────────────────────────────────────────────
  const toplamSayfa = Math.ceil(filtered.length / ayarlar.harSayfaBoy);
  if (harSayfa >= toplamSayfa) harSayfa = toplamSayfa - 1;
  const sayfa = filtered.slice(harSayfa * ayarlar.harSayfaBoy, (harSayfa+1) * ayarlar.harSayfaBoy);

  // ── Liste render ──────────────────────────────────────────────
  list.innerHTML = sayfa.map(h => `
    <div class="hareket-item">
      <div class="hareket-dot ${h.tur==='Giriş'?'dot-giris':'dot-cikis'}">${h.tur==='Giriş'?'⬆':'⬇'}</div>
      <div class="hareket-info">
        <div class="hareket-mal">${esc(h.malzeme)}</div>
        <div class="hareket-meta">${depoBadge(h.depo)} · <span title="${esc(fmt(new Date(h.tarih)))}">${timeAgo(new Date(h.tarih))}</span> · <span style="color:var(--muted);font-size:10px">${esc(fmt(new Date(h.tarih)))}</span>${h.personel?' · '+esc(h.personel):''}${h.belge?' · <span class="td-mono">'+esc(h.belge)+'</span>':''}</div>
        ${h.not?`<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(h.not)}</div>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="hareket-miktar ${h.tur==='Giriş'?'giris-clr':'cikis-clr'}">${h.tur==='Giriş'?'+':'−'}${h.miktar}</div>
        <button class="har-sil-btn" onclick="hareketSil('${escQ(h.id)}')" title="Sil / Geri Al">🗑</button>
      </div>
    </div>`).join('');

  // ── Sayfalama butonları ───────────────────────────────────────
  if (spEl) {
    if (toplamSayfa <= 1) { spEl.innerHTML = `<span class="sayfa-info">${filtered.length} kayıt</span>`; return; }
    let btns = `<button class="sayfa-btn" onclick="harSayfa--;renderHareketList()" ${harSayfa===0?'disabled':''}>‹</button>`;
    const start = Math.max(0, harSayfa-2), end2 = Math.min(toplamSayfa, harSayfa+3);
    if (start > 0) btns += `<span class="sayfa-info">…</span>`;
    for (let p=start; p<end2; p++) {
      btns += `<button class="sayfa-btn ${p===harSayfa?'aktif':''}" onclick="harSayfa=${p};renderHareketList()">${p+1}</button>`;
    }
    if (end2 < toplamSayfa) btns += `<span class="sayfa-info">…</span>`;
    btns += `<button class="sayfa-btn" onclick="harSayfa++;renderHareketList()" ${harSayfa===toplamSayfa-1?'disabled':''}>›</button>`;
    btns += `<span class="sayfa-info">${filtered.length} kayıt · Sayfa ${harSayfa+1}/${toplamSayfa}</span>`;
    spEl.innerHTML = btns;
  }
}

// ═══════════════════════════════════════════════════════════════════
// İSTATİSTİKLER
// ═══════════════════════════════════════════════════════════════════
async function renderIstatistik() {
  renderChartDurum('chartDurum2');

  // Trend ve en-aktif verisi: API varsa sunucudan, yoksa bellekten hesapla
  let trend = null, enAktif = null;
  if (API_MOD) {
    try {
      const r = await apiFetch(API_URL+'?action=istatistik');
      const j = await r.json();
      if (j.ok) { trend = j.trend; enAktif = j.enAktif; }
    } catch(e) { console.warn('istatistik:', e); }
  }
  if (!trend) {
    trend = [];
    const now = new Date();
    for (let i=5;i>=0;i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const label = d.toLocaleDateString('tr-TR',{month:'short',year:'2-digit'});
      const mH = hareketler.filter(h=>{ const hd=new Date(h.tarih); return hd.getMonth()===d.getMonth()&&hd.getFullYear()===d.getFullYear(); });
      trend.push({
        label,
        giris: mH.filter(h=>h.tur==='Giriş').reduce((a,h)=>a+h.miktar,0),
        cikis: mH.filter(h=>h.tur==='Çıkış').reduce((a,h)=>a+h.miktar,0),
      });
    }
  }
  if (!enAktif) {
    const sayac={};
    hareketler.forEach(h=>{ sayac[h.malzeme]=(sayac[h.malzeme]||0)+1; });
    enAktif = Object.entries(sayac).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([ad,cnt])=>({ad,cnt}));
  }

  if (chartTrend) chartTrend.destroy();
  chartTrend = new Chart(document.getElementById('chartTrend'),{
    type:'line',
    data:{labels:trend.map(t=>t.label),datasets:[
      {label:'Giriş',data:trend.map(t=>t.giris),borderColor:'#2e7d32',backgroundColor:'rgba(46,125,50,.1)',tension:.4,fill:true},
      {label:'Çıkış',data:trend.map(t=>t.cikis),borderColor:'#d32f2f',backgroundColor:'rgba(211,47,47,.08)',tension:.4,fill:true}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom'}},
      scales:{y:{beginAtZero:true,grid:{color:'#dde4ec'}},x:{grid:{display:false}}}}
  });

  const depKritik = Object.keys(DEPO_META).map(dep=>
    getDepoItems(dep).filter(item=>{
      const s=getStok(dep,item.ad); return durum(s.mevcut,s.min,s.max)==='Kritik';
    }).length);
  if (chartKritikDepo) chartKritikDepo.destroy();
  chartKritikDepo = new Chart(document.getElementById('chartKritikDepo'),{
    type:'bar',
    data:{labels:Object.keys(DEPO_META),
      datasets:[{label:'Kritik Kalem',data:depKritik,backgroundColor:'rgba(211,47,47,.8)',borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:true,grid:{color:'#dde4ec'}},x:{grid:{display:false}}}}
  });

  const el=document.getElementById('aktif-malzeme-list');
  el.innerHTML = enAktif.length===0
    ? '<p style="color:var(--muted);font-size:13px;">Henüz hareket kaydı yok.</p>'
    : enAktif.map(({ad,cnt},_,arr)=>`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="flex:1;font-size:13px;font-weight:500">${ad}</div>
        <div class="stok-bar" style="width:140px;height:8px"><div class="stok-bar-fill fill-normal" style="width:${Math.round(cnt/arr[0].cnt*100)}%"></div></div>
        <div class="td-mono" style="min-width:30px;text-align:right">${cnt}</div>
      </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════════
// KRİTİK STOK
// ═══════════════════════════════════════════════════════════════════
function renderKritik() {
  let rows='', idx=0;
  getAllItems().forEach(item=>{
    const s=getStok(item.depo,item.ad);
    const d=durum(s.mevcut,s.min,s.max);
    if (d!=='Kritik') return;
    idx++;
    rows+=`<tr>
      <td class="td-mono" style="color:var(--muted)">${idx}</td>
      <td class="td-name">${item.ad}${malzemeMeta[getKey(item.depo,item.ad)]?.skt?'<br>'+sktBadge(malzemeMeta[getKey(item.depo,item.ad)].skt):''}</td>
      <td>${depoBadge(item.depo)}</td>
      <td>${durumBadge(d)}</td>
      <td class="td-mono" style="color:var(--red);font-weight:700">${s.mevcut}</td>
      <td class="td-mono">${s.min}</td>
      <td class="td-mono" style="color:var(--red);font-weight:600">${s.mevcut-s.min}</td>
    </tr>`;
  });
  // SKT özet panelini güncelle
  const _today = new Date(); _today.setHours(0,0,0,0);
  let _gecmis=0, _90g=0, _ok=0;
  const _sktItems = getAllItems().filter(i => i.depo==='Kimyasal Deposu' && (malzemeMeta[getKey(i.depo,i.ad)]||{}).skt);
  _sktItems.forEach(i => {
    const mm = malzemeMeta[getKey(i.depo,i.ad)]||{};
    const diff = Math.round((new Date(mm.skt) - _today)/86400000);
    if (diff < 0) _gecmis++;
    else if (diff <= ayarlar.sktKritikGun) _90g++;
    else _ok++;
  });
  const _sg = document.getElementById('skt-gecmis-sayi');
  const _s9 = document.getElementById('skt-90g-sayi');
  const _so = document.getElementById('skt-ok-sayi');
  if(_sg) _sg.textContent=_gecmis;
  if(_s9) _s9.textContent=_90g;
  if(_so) _so.textContent=_ok;
  // SKT listesi
  const _sktListe = document.getElementById('skt-ozet-liste');
  if (_sktListe) {
    const _urgent = _sktItems.filter(i => {
      const diff = Math.round((new Date((malzemeMeta[getKey(i.depo,i.ad)]||{}).skt) - _today)/86400000);
      return diff <= ayarlar.sktKritikGun;
    }).sort((a,b) => new Date((malzemeMeta[getKey(a.depo,a.ad)]||{}).skt) - new Date((malzemeMeta[getKey(b.depo,b.ad)]||{}).skt));
    _sktListe.innerHTML = _urgent.length ? _urgent.map(i => {
      const mm = malzemeMeta[getKey(i.depo,i.ad)]||{};
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
        <div style="flex:1;font-size:13px">${i.ad}</div>
        <div>${sktBadge(mm.skt)}</div>
      </div>`;
    }).join('') : '<p style="font-size:13px;color:var(--muted);text-align:center;padding:12px">Son 90 gün içinde biten kimyasal yok.</p>';
  }
  document.getElementById('kritik-tbody').innerHTML = rows ||
    '<tr><td colspan="7" style="padding:0"><div class="empty-state"><div class="empty-icon"><i data-lucide="check-circle"></i></div><div class="empty-title">Kritik stok yok</div><div class="empty-desc">Tüm malzemeler yeterli seviyede.</div></div></td></tr>';
  if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('kritik-tbody')] });

  // FIX: "Talepnameye Aktar" butonu – sadece kritik varsa göster
  const btn = document.getElementById('kritik-talep-btn');
  if (btn) btn.style.display = idx>0 ? '' : 'none';
}

// YENİ: Kritik stokları tek tıkla talepnameye aktar
function kritikTalepAktar() {
  const kritikler = [];
  getAllItems().forEach(item=>{
    const s=getStok(item.depo,item.ad);
    if (durum(s.mevcut,s.min,s.max)==='Kritik')
      kritikler.push({ad:item.ad, depo:item.depo, mevcut:s.mevcut, min:s.min});
  });
  if (kritikler.length===0) { toast('Kritik stok yok.','error'); return; }

  // Pass kritikler to initTalep via flag to avoid async race condition
  _pendingKritikler = kritikler;
  talepSatirCount = 0;
  document.getElementById('talep-tbody').innerHTML = '';
  navigate('talep'); // initTalep picks up _pendingKritikler after awaiting yeniTalepno
}

// ═══════════════════════════════════════════════════════════════════
// DEPO DETAY
// ═══════════════════════════════════════════════════════════════════
function goDetay(dep) {
  window._aktifDetayDep = dep;
  const meta  = DEPO_META[dep];
  const items = getDepoItems(dep);
  let kritikC=0;
  items.forEach(i=>{ const s=getStok(dep,i.ad); if(durum(s.mevcut,s.min,s.max)==='Kritik') kritikC++; });

  let rows='';
  items.forEach((item,idx)=>{
    const s=getStok(dep,item.ad);
    const d=durum(s.mevcut,s.min,s.max);
    const pct=s.max>0?Math.min(100,Math.round((s.mevcut/s.max)*100)):0;
    const fillCls=d==='Kritik'?'fill-kritik':d==='Fazla'?'fill-fazla':'fill-normal';
    const key=escKey(dep,item.ad);
    const rowCls2 = d==='Kritik'?'row-kritik':d==='Fazla'?'row-fazla':'';
    rows+=`<tr class="${rowCls2}">
      <td class="td-mono" style="color:var(--muted)">${idx+1}</td>
      <td class="td-name">${esc(item.ad)}${malzemeMeta[getKey(dep,item.ad)]?.skt?'<br>'+sktBadge(malzemeMeta[getKey(dep,item.ad)].skt):''}</td>
      <td class="td-mono" style="font-weight:700;color:${d==='Kritik'?'var(--red)':d==='Fazla'?'var(--amber)':'var(--blue)'}">${s.mevcut}</td>
      <td class="td-mono" style="color:var(--muted)">${esc((malzemeMeta[getKey(dep,item.ad)]||{}).birim||'—')}</td>
      <td class="td-mono">${s.min}</td>
      <td class="td-mono">${s.max}</td>
      <td><div class="stok-bar-wrap"><div class="stok-bar"><div class="stok-bar-fill ${fillCls}" style="width:${pct}%"></div></div><span class="stok-num">${pct}%</span></div></td>
      <td>${durumBadge(d)}</td>
      <td><button class="btn btn-sm btn-outline" onclick="openStokModal('${key}','${escQ(dep)}','${escQ(item.ad)}')">✎</button></td>
    </tr>`;
  });

  document.getElementById('detay-content').innerHTML=`
    <div class="card" style="margin-bottom:20px">
      <div style="background:${meta.color};padding:20px 24px;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:18px;font-weight:700;color:#fff">${esc(dep)}</div>
        </div>
        <div style="display:flex;gap:16px">
          <div style="text-align:center">
            <div style="font-size:28px;font-weight:700;color:#fff;font-family:'IBM Plex Mono',monospace">${items.length}</div>
            <div style="font-size:11px;color:rgba(255,255,255,.7)">Toplam Kalem</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:28px;font-weight:700;color:${kritikC>0?'#ffcdd2':'rgba(255,255,255,.9)'};font-family:'IBM Plex Mono',monospace">${kritikC}</div>
            <div style="font-size:11px;color:rgba(255,255,255,.7)">Kritik Stok</div>
          </div>
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>#</th><th>Malzeme</th><th>Mevcut</th><th>Birim</th><th>Min</th><th>Max</th><th>Doluluk</th><th>Durum</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  aktifSayfa='depo-detay';
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-depo-detay').classList.add('active');
}

// ═══════════════════════════════════════════════════════════════════
// MALZEME EKLE / SİL
// ═══════════════════════════════════════════════════════════════════

// Not zorunluluğu ayarı
let notZorunlu = false;
function toggleNotZorunlu() {
  notZorunlu = !notZorunlu;
  const btn = document.getElementById('not-zorunlu-btn');
  const lbl = document.getElementById('h-not-label');
  if (btn) btn.classList.toggle('active', notZorunlu);
  if (lbl) lbl.textContent = notZorunlu ? 'Not (zorunlu)' : 'Not (opsiyonel)';
  if (lbl) lbl.classList.toggle('har-not-lbl-aktif', notZorunlu);
}


function openMalHareket(dep, mal) {
  const title = document.getElementById('modal-mal-har-title');
  const ozet  = document.getElementById('modal-mal-har-ozet');
  const liste = document.getElementById('modal-mal-har-liste');
  if (!title||!ozet||!liste) return;

  title.textContent = mal + ' — Hareket Geçmişi';

  const malHar = hareketler.filter(h => h.depo===dep && h.malzeme===mal)
                            .slice().reverse();

  const topGiris = malHar.filter(h=>h.tur==='Giriş').reduce((s,h)=>s+h.miktar,0);
  const topCikis = malHar.filter(h=>h.tur==='Çıkış').reduce((s,h)=>s+h.miktar,0);
  const s = getStok(dep, mal);

  ozet.innerHTML = `
    <div style="padding:10px;border-radius:8px;border:1px solid var(--line);text-align:center">
      <div style="font-size:20px;font-weight:700;color:var(--green);font-family:'IBM Plex Mono',monospace">+${topGiris}</div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Toplam Giriş</div>
    </div>
    <div style="padding:10px;border-radius:8px;border:1px solid var(--line);text-align:center">
      <div style="font-size:20px;font-weight:700;color:var(--red);font-family:'IBM Plex Mono',monospace">−${topCikis}</div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Toplam Çıkış</div>
    </div>
    <div style="padding:10px;border-radius:8px;border:1px solid var(--line);text-align:center">
      <div style="font-size:20px;font-weight:700;color:var(--blue);font-family:'IBM Plex Mono',monospace">${s.mevcut}</div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Mevcut Stok</div>
    </div>`;

  if (!malHar.length) {
    liste.innerHTML = '<p style="text-align:center;color:var(--muted);font-size:13px;padding:20px">Bu malzeme için hareket kaydı yok.</p>';
  } else {
    liste.innerHTML = malHar.map(h => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
        <div style="width:28px;height:28px;border-radius:50%;background:${h.tur==='Giriş'?'rgba(102,187,106,.15)':'rgba(239,83,80,.12)'};
             display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">
          ${h.tur==='Giriş'?'⬆':'⬇'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:var(--ink2)">${esc(fmt(new Date(h.tarih)))}${h.personel?' · '+esc(h.personel):''}</div>
          ${h.not?`<div style="font-size:11px;color:var(--muted)">${esc(h.not)}</div>`:''}
        </div>
        <div style="font-size:14px;font-weight:700;font-family:'IBM Plex Mono',monospace;color:${h.tur==='Giriş'?'var(--green)':'var(--red)'};flex-shrink:0">
          ${h.tur==='Giriş'?'+':'−'}${h.miktar}
        </div>
      </div>`).join('');
  }
  document.getElementById('modal-mal-hareket').classList.add('open');
}


function hizliHareket(dep, mal, tur) {
  const mikStr = prompt(`${mal}\n${tur} miktarı girin:`, '1');
  if (!mikStr) return;
  const mik = parseInt(mikStr);
  if (!mik || mik <= 0) { toast('Geçersiz miktar!', 'error'); return; }
  const s = getStok(dep, mal);
  if (tur === 'Çıkış' && s.mevcut < mik) { toast('Yetersiz stok! Mevcut: ' + s.mevcut, 'error'); return; }
  s.mevcut = tur === 'Giriş' ? s.mevcut + mik : s.mevcut - mik;
  hareketler.push({
    id: Date.now()+'-'+Math.random().toString(36).slice(2,7),
    tarih: new Date().toISOString(),
    depo: dep, malzeme: mal, tur, miktar: mik, belge: '', personel: '', not: 'Hızlı hareket'
  });
  refreshAll();
  toast(`${tur} kaydedildi: ${mal} (${mik})`);
}


// ── Toplu Hareket ─────────────────────────────────────────────────
let harMod = 'tek';
let topluHarCount = 0;

function setHarMod(mod) {
  harMod = mod;
  document.getElementById('toplu-har-panel').style.display = mod==='toplu' ? 'block' : 'none';
  document.getElementById('har-mod-tek').classList.toggle('active', mod==='tek');
  document.getElementById('har-mod-toplu').classList.toggle('active', mod==='toplu');
  if (mod==='toplu' && document.getElementById('toplu-har-rows').children.length===0) topluHarSatirEkle();
}

function topluHarSatirEkle() {
  const id = 'thr-' + (++topluHarCount);
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = 'display:grid;grid-template-columns:1fr 80px 70px 20px;gap:6px;margin-bottom:8px;align-items:center';
  const depOpts = Object.keys(KAYNAK).map(d=>`<option>${d}</option>`).join('');
  const malOpts = '<option value="">— Malzeme —</option>';
  div.innerHTML = `
    <select class="thr-dep" onchange="topluHarDepChange(this,'${id}')" style="padding:7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px;background:var(--white);color:var(--ink2)">
      <option value="">— Depo —</option>${depOpts}
    </select>
    <select class="thr-tur" style="padding:7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px;background:var(--white);color:var(--ink2)">
      <option>Giriş</option><option>Çıkış</option>
    </select>
    <input type="number" class="thr-mik" min="1" value="1" style="padding:7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px;background:var(--white);color:var(--ink);text-align:center">
    <button onclick="document.getElementById('${id}').remove()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px">×</button>
    <select class="thr-mal" style="padding:7px;border:1.5px solid var(--line);border-radius:7px;font-size:12px;background:var(--white);color:var(--ink2);grid-column:1/-2">
      ${malOpts}
    </select>`;
  document.getElementById('toplu-har-rows').appendChild(div);
}

function topluHarDepChange(sel, rowId) {
  const dep = sel.value;
  const row = document.getElementById(rowId);
  if (!row) return;
  const malSel = row.querySelector('.thr-mal');
  const items = dep ? getDepoItems(dep) : [];
  malSel.innerHTML = '<option value="">— Malzeme —</option>' +
    items.map(i => {
      const s = getStok(dep, i.ad);
      return `<option value="${escQ(i.ad)}">${i.ad} (${s.mevcut})`;
    }).join('');
}

function topluHarKaydet() {
  const rows = document.querySelectorAll('#toplu-har-rows > div');
  let saved = 0, errors = [];
  rows.forEach(row => {
    const dep = row.querySelector('.thr-dep')?.value;
    const mal = row.querySelector('.thr-mal')?.value;
    const tur = row.querySelector('.thr-tur')?.value;
    const mik = parseInt(row.querySelector('.thr-mik')?.value||'0');
    if (!dep || !mal) return;
    if (!mik || mik<=0) { errors.push(mal + ': geçersiz miktar'); return; }
    const s = getStok(dep, mal);
    if (tur==='Çıkış' && s.mevcut < mik) { errors.push(mal + ': yetersiz stok (' + s.mevcut + ')'); return; }
    s.mevcut = tur==='Giriş' ? s.mevcut+mik : s.mevcut-mik;
    hareketler.push({ id: Date.now()+'-'+Math.random().toString(36).slice(2,7),
      tarih: new Date().toISOString(), depo:dep, malzeme:mal, tur, miktar:mik,
      belge:'', personel:'', not:'Toplu kayıt' });
    saved++;
  });
  if (errors.length) toast('Hatalar: ' + errors.join(', '), 'error');
  if (saved > 0) {
    refreshAll();
    document.getElementById('toplu-har-rows').innerHTML = '';
    topluHarSatirEkle();
    toast(saved + ' hareket kaydedildi ✓');
  }
}

function toggleYeniSKT(dep) {
  const wrap = document.getElementById('yeni-skt-wrap');
  if (wrap) wrap.style.display = (dep === 'Kimyasal Deposu') ? 'block' : 'none';
}

function malzemeEkle() {
  const dep    = document.getElementById('yeni-depo').value;
  const ad     = document.getElementById('yeni-ad').value.trim();
  const birim    = getDigerVal('yeni-birim','yeni-birim-diger');
  const kategori  = getDigerVal('yeni-kategori','yeni-kategori-diger');
  const marka     = (document.getElementById('yeni-marka')?.value||'').trim();
  const mevcut = parseInt(document.getElementById('yeni-mevcut').value)||0;
  const min    = parseInt(document.getElementById('yeni-min').value)||0;
  const max    = parseInt(document.getElementById('yeni-max').value)||0;

  if (!dep)  { toast('Depo seçin!','error'); return; }
  if (!ad)   { toast('Malzeme adı girin!','error'); return; }
  if (!kategori && ayarlar.katZorunlu) { toast('Kategori seçimi zorunlu!','error'); return; }

  // Aynı isim var mı?
  const mevcut_items = getDepoItems(dep);
  if (mevcut_items.find(i=>i.ad.toLowerCase()===ad.toLowerCase())) {
    toast('Bu isimde malzeme zaten mevcut!','error'); return;
  }

  const k = getKey(dep, ad);
  ozelMalzeme[k]={ad, sayim: (mevcut ? String(mevcut) : '0') + (birim ? ' ' + birim : ''), depo:dep, birim, kategori, marka};
  malzemeMeta[k]={birim, kategori, marka};
  const _nskt = document.getElementById('yeni-skt');
  if (_nskt && _nskt.value) malzemeMeta[k].skt = _nskt.value;
  stok[k] = {mevcut, min, max};

  // Formu temizle
  ['yeni-depo','yeni-ad','yeni-birim','yeni-kategori','yeni-marka','yeni-birim-diger','yeni-kategori-diger','yeni-skt'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['yeni-birim-diger-wrap','yeni-kategori-diger-wrap'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  ['yeni-mevcut','yeni-min','yeni-max'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=id==='yeni-mevcut'?'0':id==='yeni-min'?'1':'10'; });

  renderMalzemeEkleList();
  refreshAll();
  toast(`"${ad}" eklendi ✓`);
}

function malzemeSil(dep, ad) {
  if (!confirm(`"${ad}" malzemesini silmek istediğinizden emin misiniz?`)) return;
  const k = getKey(dep, ad);
  if (ozelMalzeme[k]) {
    delete ozelMalzeme[k];
    delete stok[k];
  } else {
    silinmis[k] = true;
  }
  renderMalzemeEkleList();
  refreshAll();
  toast(`"${ad}" silindi.`);
}

function renderMalzemeEkleList() {
  const q    = (document.getElementById('ekle-search')?.value||'').toLowerCase();
  const depF = document.getElementById('ekle-depo-filter')?.value||'';
  const tbody= document.getElementById('malzeme-ekle-tbody');
  if (!tbody) return;
  let rows='', idx=0;
  getAllItems().forEach(item=>{
    if (depF && item.depo!==depF) return;
    if (q && !item.ad.toLowerCase().includes(q) && !item.depo.toLowerCase().includes(q)) return;
    idx++;
    const s   = getStok(item.depo, item.ad);
    const d   = durum(s.mevcut, s.min, s.max);
    const mm  = malzemeMeta[getKey(item.depo,item.ad)]||{};
    const key = escKey(item.depo, item.ad);
    const sktHtml = mm.skt ? '<br>'+sktBadge(mm.skt) : '';
    const ozelStar = item.ozel ? '<span style="font-size:10px;color:var(--teal);margin-left:5px">★</span>' : '';
    const birimTxt = mm.birim || item.birim || '—';
    const katHtml  = item.kategori ? katBadgeHTML(item.kategori) : '<span style="color:var(--muted)">—</span>';
    rows += `<tr>
      <td class="td-name">${esc(item.ad)}${ozelStar}${sktHtml}</td>
      <td>${depoBadge(item.depo)}</td>
      <td class="td-mono" style="font-size:11px">${esc(birimTxt)}</td>
      <td>${katHtml}</td>
      <td class="td-mono" style="font-weight:700;color:${d==='Kritik'?'var(--red)':d==='Fazla'?'var(--amber)':'var(--blue)'}">${s.mevcut}</td>
      <td>${durumBadge(d)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-outline" onclick="openStokModal('${key}','${escQ(item.depo)}','${escQ(item.ad)}')" style="margin-right:4px">✎</button>
        <button class="btn btn-sm" onclick="malzemeSil('${escQ(item.depo)}','${escQ(item.ad)}')"
          style="background:var(--red-bg);color:var(--red);border:1px solid rgba(239,83,80,.3);padding:4px 10px;font-size:11px">🗑</button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = rows || `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">Malzeme bulunamadı.</td></tr>`;
}

// ═══════════════════════════════════════════════════════════════════
// VERİ YÖNETİMİ – DIŞA / İÇE AKTAR
// ═══════════════════════════════════════════════════════════════════
async function renderBackupList() {
  const kart = document.getElementById('api-yedek-kart');
  const liste = document.getElementById('api-yedek-liste');
  if (!kart || !liste) return;
  if (!API_MOD) { kart.style.display='none'; return; }
  kart.style.display='block';
  liste.innerHTML='<p style="font-size:13px;color:var(--muted)">Yükleniyor...</p>';
  const yedekler = await apiBackupList();
  if (!yedekler.length) {
    liste.innerHTML='<p style="font-size:13px;color:var(--muted)">Henüz yedek yok.</p>'; return;
  }
  liste.innerHTML = yedekler.map(y=>`
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600;font-family:'IBM Plex Mono',monospace">${esc(y.tarih)}</div>
        <div style="font-size:10px;color:var(--muted)">${esc(y.dosya)} · ${esc(y.boyut)}</div>
      </div>
      <button class="btn btn-sm btn-outline" onclick="apiBackupLoad('${escQ(y.dosya)}')">↩ Yükle</button>
    </div>`).join('');
}

function refreshVeriYonet() {
  const toplam = getAllItems().length;
  const ozelC  = Object.keys(ozelMalzeme).length;
  document.getElementById('export-toplam').textContent  = toplam;
  document.getElementById('export-hareket').textContent = hareketler.length;
  document.getElementById('export-ozel').textContent    = ozelC;
}


// ── Excel Raporu Dışa Aktarım (SheetJS) ──────────────────────────
async function veriExcelAktar() {
  if (!window.XLSX) {
    toast('Excel kütüphanesi yükleniyor...');
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = res; s.onerror = () => rej(new Error('SheetJS yüklenemedi'));
      document.head.appendChild(s);
    }).catch(e => { toast('Excel kütüphanesi yüklenemedi: ' + e.message, 'error'); throw e; });
  }
  const wb = window.XLSX.utils.book_new();

  // Sayfa 1: Tüm Stok
  const stokRows = [['#','Malzeme Adı','Depo','Birim','Kategori','Mevcut','Min','Max','Durum']];
  let idx = 1;
  getAllItems().forEach(item => {
    const s  = getStok(item.depo, item.ad);
    const mm = malzemeMeta[getKey(item.depo, item.ad)] || {};
    stokRows.push([idx++, item.ad, item.depo, mm.birim||item.birim||'', item.kategori||mm.kategori||'',
      s.mevcut, s.min, s.max, durum(s.mevcut, s.min, s.max)]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stokRows), 'Stok Listesi');

  // Sayfa 2: Hareket Geçmişi
  const harRows = [['Tarih','Depo','Malzeme','Tür','Miktar','Belge','Personel','Not']];
  [...hareketler].reverse().forEach(h => {
    harRows.push([new Date(h.tarih).toLocaleString('tr-TR'), h.depo, h.malzeme,
      h.tur, h.miktar, h.belge||'', h.personel||'', h.not||'']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(harRows), 'Hareket Geçmişi');

  // Sayfa 3: Kimyasal SKT
  const sktRows = [['Malzeme','Mevcut','Son Kullanma Tarihi','Durum']];
  getAllItems().filter(i => i.depo === 'Kimyasal Deposu').forEach(item => {
    const mm = malzemeMeta[getKey(item.depo, item.ad)] || {};
    const s  = getStok(item.depo, item.ad);
    const sd = mm.skt ? sktDurum(mm.skt) : null;
    sktRows.push([item.ad, s.mevcut, mm.skt || '', sd ? sd.label : '']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sktRows), 'Kimyasal SKT');

  const tarih = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
  XLSX.writeFile(wb, 'depo_rapor_' + tarih + '.xlsx');
  toast('Excel raporu indirildi ✓');
}

function veriDisaAktar() {
  const payload = {
    version:'2.1',
    tarih:new Date().toISOString(),
    stok,hareketler,ozelMalzeme,silinmis,malzemeMeta
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `depo_takip_${new Date().toLocaleDateString('tr-TR').replace(/\./g,'-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('JSON dosyası indirildi ✓');
}

function veriIceAktar(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.stok) { toast('Geçersiz dosya formatı!','error'); return; }
      stok=data.stok||{};hareketler=data.hareketler||[];
      ozelMalzeme=data.ozelMalzeme||{};silinmis=data.silinmis||{};malzemeMeta=data.malzemeMeta||{};
      refreshAll();
      refreshVeriYonet();
      toast(`Veri yüklendi: ${hareketler.length} hareket, ${Object.keys(stok).length} stok kaydı ✓`);
    } catch(err) {
      toast('Dosya okunamadı: ' + err.message, 'error');
    }
    input.value='';
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════════════════
// AYARLAR SAYFASI
// ═══════════════════════════════════════════════════════════════════
let ayarlarAktifTab = 'genel';
let ayarlarArama = '';
function setAyarlarTab(t) {
  ayarlarAktifTab = t;
  ayarlarArama = '';
  renderAyarlar();
}
function ayarlarAraOlay(q) {
  ayarlarArama = q || '';
  renderAyarlar();
}
function _ayarlarAramaFiltre(terim) {
  const panel = document.getElementById('ayarlar-panel-icerik');
  if (!panel) return;
  const t = terim.toLocaleLowerCase('tr');
  panel.querySelectorAll('.card').forEach(card => {
    let gorunurSatir = 0;
    card.querySelectorAll('.ayar-row').forEach(row => {
      const match = row.textContent.toLocaleLowerCase('tr').includes(t);
      row.style.display = match ? '' : 'none';
      if (match) gorunurSatir++;
    });
    card.style.display = gorunurSatir === 0 ? 'none' : '';
  });
}

function renderAyarlar() {
  const el = document.getElementById('ayarlar-icerik');
  if (!el) return;

  const depList = Object.keys(DEPO_META);
  const depOpts = depList.map(d => `<option value="${d}"${ayarlar.varsayilanDepo===d?' selected':''}>${d}</option>`).join('');

  const kurumHtml = `<div class="card"><div class="card-header"><i data-lucide="building-2" class="icon-inline"></i> Kurum Bilgisi</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">Kurum / Sistem Adı<small>Başlık ve talepname üst bilgisinde görünür</small></div>
      <input type="text" class="ayar-input-full" maxlength="100" value="${esc(ayarlar.kurumAdi||'')}" onchange="setAyar('kurumAdi',this.value.trim())" placeholder="Depo Yönetim Sistemi"></div>
  </div></div>`;

  const temaHtml = `<div class="card"><div class="card-header"><i data-lucide="palette" class="icon-inline"></i> Görünüm</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">Tema<small>Açık / Koyu / Sistem</small></div>
      <div class="btn-group">
        <button class="btn btn-sm ${ayarlar.tema==='light'?'btn-primary':'btn-outline'}" onclick="setTema('light')"><i data-lucide="sun" class="icon-inline"></i> Açık</button>
        <button class="btn btn-sm ${ayarlar.tema==='dark'?'btn-primary':'btn-outline'}" onclick="setTema('dark')"><i data-lucide="moon" class="icon-inline"></i> Koyu</button>
        <button class="btn btn-sm ${ayarlar.tema==='auto'?'btn-primary':'btn-outline'}" onclick="setTema('auto')"><i data-lucide="monitor" class="icon-inline"></i> Otomatik</button>
      </div></div>
    <div class="ayar-row"><div class="ayar-label">Yazı Tipi Boyutu<small id="yazitipiBoy-lbl">Şu an: ${ayarlar.yazitipiBoy||100}%</small></div>
      <input type="range" min="80" max="130" step="5" value="${ayarlar.yazitipiBoy||100}"
        oninput="document.getElementById('yazitipiBoy-lbl').textContent='Şu an: '+this.value+'%';setAyar('yazitipiBoy',+this.value);document.documentElement.style.fontSize=this.value+'%'"
        style="width:160px"></div>
    <div class="ayar-row"><div class="ayar-label">Tarih Formatı<small>Listelerde görünen tarih biçimi</small></div>
      <div class="btn-group">
        <button class="btn btn-sm ${ayarlar.tarihFormat==='tr'?'btn-primary':'btn-outline'}" onclick="setAyar('tarihFormat','tr');renderAyarlar()">TR (31.12.2025)</button>
        <button class="btn btn-sm ${ayarlar.tarihFormat==='iso'?'btn-primary':'btn-outline'}" onclick="setAyar('tarihFormat','iso');renderAyarlar()">ISO (2025-12-31)</button>
      </div></div>
  </div></div>`;

  const esikHtml = `<div class="card"><div class="card-header"><i data-lucide="gauge" class="icon-inline"></i> Eşik & Limitler</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">SKT Uyarı Eşiği (gün)<small>Son kullanma tarihine bu kadar gün kala uyar</small></div>
      <input type="number" class="ayar-input" min="1" max="730" value="${ayarlar.sktUyariGun}" onchange="setAyar('sktUyariGun',+this.value)"></div>
    <div class="ayar-row"><div class="ayar-label">SKT Kritik Eşiği (gün)<small>Bu kadar günden az kaldıysa kırmızı göster</small></div>
      <input type="number" class="ayar-input" min="1" max="365" value="${ayarlar.sktKritikGun}" onchange="setAyar('sktKritikGun',+this.value)"></div>
    <div class="ayar-row"><div class="ayar-label">Dashboard kritik limit<small>Kritik listede en fazla kaç satır gösterilsin</small></div>
      <input type="number" class="ayar-input" min="1" max="50" value="${ayarlar.dashKritikLimit}" onchange="setAyar('dashKritikLimit',+this.value)"></div>
    <div class="ayar-row"><div class="ayar-label">Dashboard son hareketler<small>Ana sayfada kaç hareket gösterilsin</small></div>
      <input type="number" class="ayar-input" min="1" max="50" value="${ayarlar.sonHareketLimit||8}" onchange="setAyar('sonHareketLimit',+this.value)"></div>
    <div class="ayar-row"><div class="ayar-label">Stok listesi sayfa boyutu<small>Sayfa başına kaç satır</small></div>
      <input type="number" class="ayar-input" min="10" max="500" value="${ayarlar.stokSayfaBoy||100}" onchange="setAyar('stokSayfaBoy',+this.value)"></div>
    <div class="ayar-row"><div class="ayar-label">Hareket listesi sayfa boyutu<small>Sayfa başına kaç satır</small></div>
      <input type="number" class="ayar-input" min="10" max="500" value="${ayarlar.harSayfaBoy||50}" onchange="setAyar('harSayfaBoy',+this.value)"></div>
    <div class="ayar-row"><div class="ayar-label">Varsayılan depo<small>Hareket ve ekleme formlarında otomatik seçilir</small></div>
      <select class="ayar-input-sel" onchange="setAyar('varsayilanDepo',this.value)">
        <option value="">— Seçilmedi —</option>${depOpts}
      </select></div>
    <div class="ayar-row"><div class="ayar-label">Varsayılan min stok<small>Yeni malzeme eklerken ön değer</small></div>
      <input type="number" class="ayar-input" min="0" value="${ayarlar.varsayilanMinStok??1}" onchange="setAyar('varsayilanMinStok',+this.value)"></div>
    <div class="ayar-row"><div class="ayar-label">Varsayılan max stok</div>
      <input type="number" class="ayar-input" min="0" value="${ayarlar.varsayilanMaxStok??10}" onchange="setAyar('varsayilanMaxStok',+this.value)"></div>
    <div class="ayar-row"><div class="ayar-label">Kategori seçimi zorunlu<small>Malzeme eklerken kategori boş bırakılamaz</small></div>
      <input type="checkbox" ${ayarlar.katZorunlu?'checked':''} onchange="setAyar('katZorunlu',this.checked)"></div>
    <div class="ayar-row"><div class="ayar-label">Hareket notu zorunlu<small>Giriş/çıkış kaydederken not alanı boş bırakılamaz</small></div>
      <input type="checkbox" ${ayarlar.hareketNot?'checked':''} onchange="setAyar('hareketNot',this.checked)"></div>
    <div class="ayar-row"><div class="ayar-label">Kritik stok bildirimi<small>${
      !('Notification' in window) ? 'Tarayıcınız desteklemiyor' :
      Notification.permission === 'granted' ? 'İzin verildi ✓' :
      Notification.permission === 'denied'  ? 'Tarayıcıda engellendi' : 'İzin gerekiyor'
    }</small></div>
      <button class="btn btn-sm ${ayarlar.bildirimAktif?'btn-primary':'btn-outline'}" onclick="bildirimIzniSor()">${
        ayarlar.bildirimAktif ? 'Aktif — Kapat' : 'Bildirimleri Aç'
      }</button></div>
  </div></div>`;

  const birimHtml = `<div class="card"><div class="card-header"><i data-lucide="ruler" class="icon-inline"></i> Birimler</div><div class="card-body">
    <div class="birim-tag-list">
      ${ayarlar.birimler.map(b=>`<span class="birim-tag">${esc(b)}<button onclick="birimSil('${escQ(b)}')">×</button></span>`).join('')}
    </div>
    <div class="ayar-add-row">
      <input type="text" id="yeni-birim-inp" placeholder="Yeni birim..." class="ayar-input-sm" maxlength="20" onkeydown="if(event.key==='Enter')birimEkle()">
      <button class="btn btn-sm btn-outline" onclick="birimEkle()">+ Ekle</button>
    </div>
  </div></div>`;

  const depoHtml = `<div class="card"><div class="card-header"><i data-lucide="warehouse" class="icon-inline"></i> Depolar</div><div class="card-body">
    ${Object.entries(DEPO_META).map(([ad,m])=>`
      <div class="ayar-row" id="depo-row-${CSS.escape(ad)}">
        <div class="ayar-label"><span class="badge" style="background:${m.color}22;color:${m.color};margin-right:6px">${esc(m.kod)}</span>${esc(ad)}</div>
        <button class="btn btn-sm btn-outline" onclick="depoYeniAdDlg('${escQ(ad)}')">✎ Düzenle</button>
      </div>`).join('')}
    <div id="depo-yeniad-form"></div>
    <div class="ayar-subsection">
      <div class="ayar-section-title">Yeni Depo Ekle</div>
      <div class="ayar-add-row">
        <input type="text" id="yd-ad" placeholder="Depo adı" class="ayar-input-md" maxlength="40">
        <input type="text" id="yd-kod" placeholder="Kod (2-3 harf)" class="ayar-input-sm" maxlength="4">
        <input type="color" id="yd-renk" value="#546e7a" class="ayar-color-inp">
        <button class="btn btn-sm btn-primary" onclick="ekDepoEkle()">+ Ekle</button>
      </div>
    </div>
  </div></div>`;

  const katHtml = `<div class="card"><div class="card-header"><i data-lucide="tags" class="icon-inline"></i> Kategoriler</div><div class="card-body">
    ${Object.entries(KAT_COLORS).map(([ad])=>`
      <div class="ayar-row">
        <div class="ayar-label">${katBadgeHTML(ad)}</div>
        <button class="btn btn-sm btn-outline" onclick="katYeniAdDlg('${escQ(ad)}')">✎ Düzenle</button>
      </div>`).join('')}
    <div id="kat-yeniad-form"></div>
    <div class="ayar-subsection">
      <div class="ayar-section-title">Yeni Kategori Ekle</div>
      <div class="ayar-add-row">
        <input type="text" id="yk-ad" placeholder="Kategori adı" class="ayar-input-md" maxlength="40">
        <input type="color" id="yk-renk-c" value="#546e7a" class="ayar-color-inp" title="Yazı rengi">
        <input type="color" id="yk-renk-bg" value="#eceff1" class="ayar-color-inp" title="Arkaplan rengi">
        <button class="btn btn-sm btn-primary" onclick="ekKatEkle()">+ Ekle</button>
      </div>
    </div>
  </div></div>`;

  const talepAyarHtml = `<div class="card"><div class="card-header"><i data-lucide="file-text" class="icon-inline"></i> Talepname Ayarları</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">Talep no ön eki<small>Örn. TLN → TLN-0001</small></div>
      <input type="text" class="ayar-input-sm" maxlength="8" value="${ayarlar.talepOnPek||'TLN'}" onchange="setAyar('talepOnPek',this.value.trim().toUpperCase()||'TLN')" style="text-transform:uppercase"></div>
    <div class="ayar-row"><div class="ayar-label">Talep eden (varsayılan)<small>Talepname açılınca otomatik dolar</small></div>
      <input type="text" class="ayar-input-md" maxlength="60" placeholder="Ad Soyad..." value="${esc(ayarlar.talepSahibi||'')}" onchange="setAyar('talepSahibi',this.value.trim())"></div>
    <div class="ayar-row"><div class="ayar-label">Onaylayan 1</div>
      <input type="text" class="ayar-input-md" maxlength="60" placeholder="Ad Unvan..." value="${esc(ayarlar.talepOnaylayan1||'')}" onchange="setAyar('talepOnaylayan1',this.value.trim())"></div>
    <div class="ayar-row"><div class="ayar-label">Onaylayan 2</div>
      <input type="text" class="ayar-input-md" maxlength="60" placeholder="Ad Unvan..." value="${esc(ayarlar.talepOnaylayan2||'')}" onchange="setAyar('talepOnaylayan2',this.value.trim())"></div>
    <div class="ayar-row"><div class="ayar-label">Onaylayan Amir (imza 3)</div>
      <input type="text" class="ayar-input-md" maxlength="60" placeholder="Ad Unvan..." value="${esc(ayarlar.talepOnaylayan3||'')}" onchange="setAyar('talepOnaylayan3',this.value.trim())"></div>
  </div></div>`;

  const veriHtml = `<div class="card"><div class="card-header"><i data-lucide="rotate-ccw" class="icon-inline"></i> Sıfırlama</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">Stok sütun sırası & görünürlük<small>Sürükle-bırak ile değiştirilen sütun düzenini sıfırla</small></div>
      <button class="btn btn-sm btn-outline" onclick="ayarlar.stokSutunSirasi=[...AYARLAR_DEFAULT.stokSutunSirasi];ayarlar.stokSutunGizli=[];ayarlariKaydet();toast('Sütun düzeni sıfırlandı ✓');">Sıfırla</button></div>
    <div class="ayar-row"><div class="ayar-label">Tüm ayarları sıfırla<small>Fabrika ayarlarına dön</small></div>
      <button class="btn btn-sm btn-outline" onclick="if(confirm('Tüm ayarlar sıfırlanacak. Emin misiniz?')){localStorage.removeItem('depoAyarlar');ayarlar={...AYARLAR_DEFAULT};applyTheme();renderAyarlar();toast('Ayarlar sıfırlandı');}">Sıfırla</button></div>
  </div></div>`;

  const panels = {
    genel:    kurumHtml + temaHtml,
    esik:     esikHtml,
    birim:    birimHtml,
    depo:     depoHtml,
    kategori: katHtml,
    talep:    talepAyarHtml,
    sifirla:  veriHtml,
  };
  const tabs = [
    { id:'genel',    icon:'sliders-horizontal', label:'Genel' },
    { id:'esik',     icon:'gauge',              label:'Eşik & Limitler' },
    { id:'birim',    icon:'ruler',              label:'Birimler' },
    { id:'depo',     icon:'warehouse',          label:'Depolar' },
    { id:'kategori', icon:'tags',               label:'Kategoriler' },
    { id:'talep',    icon:'file-text',          label:'Talepname' },
    { id:'sifirla',  icon:'rotate-ccw',         label:'Sıfırlama' },
  ];
  if (!panels[ayarlarAktifTab]) ayarlarAktifTab = 'genel';

  const terim = (ayarlarArama||'').trim();
  const aramaAktif = terim.length > 0;

  const sidebar = `<aside class="ayarlar-nav">
    <div class="ayarlar-search">
      <i data-lucide="search" class="icon-inline"></i>
      <input type="text" id="ayarlar-arama-inp" placeholder="Ayarlarda ara..." value="${esc(terim)}" oninput="ayarlarAraOlay(this.value)">
      ${aramaAktif?`<button class="ayarlar-search-clear" onclick="ayarlarAraOlay('')" title="Aramayı temizle">×</button>`:''}
    </div>
    <nav class="ayarlar-nav-list">
      ${tabs.map(t => `<button class="ayar-nav-btn ${!aramaAktif && ayarlarAktifTab===t.id?'active':''}" onclick="setAyarlarTab('${t.id}')"><i data-lucide="${t.icon}" class="icon-inline"></i><span>${t.label}</span></button>`).join('')}
    </nav>
  </aside>`;

  const icerik = aramaAktif
    ? Object.values(panels).join('')
    : (panels[ayarlarAktifTab] || panels.genel);

  el.innerHTML = sidebar + `<section class="ayarlar-panel" id="ayarlar-panel-icerik">${icerik}</section>`;

  if (aramaAktif) _ayarlarAramaFiltre(terim);
  if (window.lucide && lucide.createIcons) lucide.createIcons();
  const inp = document.getElementById('ayarlar-arama-inp');
  if (inp && aramaAktif) {
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}

function birimEkle() {
  const inp = document.getElementById('yeni-birim-inp') || document.getElementById('yeni-birim-ekle');
  const val = (inp?.value||'').trim();
  if (!val) return;
  if (ayarlar.birimler.includes(val)) { toast('Bu birim zaten var','error'); return; }
  ayarlar.birimler.push(val);
  ayarlariKaydet(); initBirimSelects(); inp.value=''; renderAyarlar();
  toast(val + ' eklendi ✓');
}
function birimSil(b) {
  const i = typeof b === 'number' ? b : ayarlar.birimler.indexOf(b);
  if (i < 0) return;
  if (!confirm(`"${ayarlar.birimler[i]}" birimini silmek istediğinizden emin misiniz?`)) return;
  ayarlar.birimler.splice(i,1);
  ayarlariKaydet(); initBirimSelects(); renderAyarlar();
}
function depoEkle() {
  const ad    = (document.getElementById('yeni-depo-ad')?.value||'').trim();
  const kod   = (document.getElementById('yeni-depo-kod')?.value||'').trim().toUpperCase();
  const color = document.getElementById('yeni-depo-renk')?.value||'#607d8b';
  if (!ad||!kod) { toast('Ad ve kod zorunlu','error'); return; }
  if (DEPO_META[ad]) { toast('Bu depo zaten var','error'); return; }
  if (!ayarlar.ekDepo) ayarlar.ekDepo=[];
  ayarlar.ekDepo.push({ad,kod,color});
  DEPO_META[ad]={kod,cls:'',color}; DEPO_BADGE[ad]='';
  ayarlariKaydet(); initDepoSelects(); renderAyarlar();
  toast(ad+' eklendi ✓');
}
function depoSil(i) {
  const d=(ayarlar.ekDepo||[])[i]; if(!d) return;
  if (!confirm(`"${d.ad}" silinecek. Mevcut stok ve hareket verileri etkilenmez.`)) return;
  delete DEPO_META[d.ad]; delete DEPO_BADGE[d.ad];
  ayarlar.ekDepo.splice(i,1);
  ayarlariKaydet(); initDepoSelects(); renderAyarlar();
  toast(d.ad+' kaldırıldı');
}
function depoEdit(i) {
  const d=(ayarlar.ekDepo||[])[i]; if(!d) return;
  const el=document.getElementById('depo-item-'+i); if(!el) return;
  el.innerHTML=`
    <input type="text" id="edit-depo-ad-${i}" value="${d.ad}" placeholder="Depo adı" style="flex:2;min-width:100px;padding:4px 8px;border:1.5px solid var(--teal);border-radius:6px;font-size:12px">
    <input type="text" id="edit-depo-kod-${i}" value="${d.kod}" maxlength="4" placeholder="Kod" style="width:70px;padding:4px 8px;border:1.5px solid var(--teal);border-radius:6px;font-size:12px">
    <input type="color" id="edit-depo-renk-${i}" value="${d.color}" class="ayar-color-inp">
    <button class="btn btn-primary btn-sm" onclick="depoGuncelle(${i})">✓</button>
    <button class="btn btn-outline btn-sm" onclick="renderAyarlar()">✕</button>`;
}
function depoGuncelle(i) {
  const d=(ayarlar.ekDepo||[])[i]; if(!d) return;
  const eskiAd=d.ad;
  const yeniAd=(document.getElementById('edit-depo-ad-'+i)?.value||'').trim();
  const yeniKod=(document.getElementById('edit-depo-kod-'+i)?.value||'').trim().toUpperCase();
  const yeniRenk=document.getElementById('edit-depo-renk-'+i)?.value||d.color;
  if(!yeniAd||!yeniKod){toast('Ad ve kod zorunlu','error');return;}
  if(yeniAd!==eskiAd&&DEPO_META[yeniAd]){toast('Bu depo adı zaten var','error');return;}
  delete DEPO_META[eskiAd]; delete DEPO_BADGE[eskiAd];
  DEPO_META[yeniAd]={kod:yeniKod,cls:'',color:yeniRenk}; DEPO_BADGE[yeniAd]='';
  d.ad=yeniAd; d.kod=yeniKod; d.color=yeniRenk;
  ayarlariKaydet(); initDepoSelects(); renderAyarlar();
  toast(yeniAd+' güncellendi ✓');
}

// ── Mevcut (built-in) depo adı düzenleme ─────────────────────────────────────
function depoBuiltinEdit(eskiAd, idx) {
  const m = DEPO_META[eskiAd]; if(!m) return;
  const el = document.getElementById('depo-bi-'+idx); if(!el) return;
  el.innerHTML = `
    <input type="text"  id="edit-bi-depo-ad-${idx}"   value="${esc(eskiAd)}" placeholder="Depo adı"
      style="flex:2;min-width:110px;padding:4px 8px;border:1.5px solid var(--teal);border-radius:6px;font-size:12px">
    <input type="text"  id="edit-bi-depo-kod-${idx}"  value="${esc(m.kod)}" maxlength="4"
      style="width:70px;padding:4px 8px;border:1.5px solid var(--teal);border-radius:6px;font-size:12px">
    <input type="color" id="edit-bi-depo-renk-${idx}" value="${m.color}" class="ayar-color-inp">
    <button class="btn btn-primary btn-sm" onclick="depoBuiltinGuncelle('${escQ(eskiAd)}',${idx})">✓</button>
    <button class="btn btn-outline btn-sm" onclick="renderAyarlar()">✕</button>`;
}
function depoBuiltinGuncelle(eskiAd, idx) {
  const yeniAd   = (document.getElementById('edit-bi-depo-ad-'+idx)?.value||'').trim();
  const yeniKod  = (document.getElementById('edit-bi-depo-kod-'+idx)?.value||'').trim().toUpperCase();
  const yeniRenk = document.getElementById('edit-bi-depo-renk-'+idx)?.value || DEPO_META[eskiAd]?.color;
  if(!yeniAd||!yeniKod){toast('Ad ve kod zorunlu','error');return;}
  if(yeniAd!==eskiAd&&DEPO_META[yeniAd]){toast('Bu depo adı zaten var','error');return;}
  if(yeniAd===eskiAd&&yeniKod===DEPO_META[eskiAd]?.kod&&yeniRenk===DEPO_META[eskiAd]?.color){renderAyarlar();return;}

  // DEPO_META ve DEPO_BADGE güncelle
  const meta = { ...DEPO_META[eskiAd], kod:yeniKod, color:yeniRenk };
  delete DEPO_META[eskiAd];
  DEPO_META[yeniAd] = meta;
  const badge = DEPO_BADGE[eskiAd]; delete DEPO_BADGE[eskiAd]; DEPO_BADGE[yeniAd] = badge||'';

  // Stok verilerini yeniden adlandır
  if(yeniAd !== eskiAd) {
    const prefix = eskiAd+'||';
    const yeniPrefix = yeniAd+'||';
    // stok
    Object.keys(stok).filter(k=>k.startsWith(prefix)).forEach(k=>{
      stok[yeniPrefix+k.slice(prefix.length)] = stok[k]; delete stok[k];
    });
    // hareketler
    hareketler.forEach(h=>{ if(h.depo===eskiAd) h.depo=yeniAd; });
    // ozelMalzeme
    const omKeys = Object.keys(ozelMalzeme).filter(k=>k.startsWith(prefix));
    omKeys.forEach(k=>{
      const om = ozelMalzeme[k]; om.depo=yeniAd;
      ozelMalzeme[yeniPrefix+k.slice(prefix.length)] = om; delete ozelMalzeme[k];
    });
    // silinmis
    Object.keys(silinmis).filter(k=>k.startsWith(prefix)).forEach(k=>{
      silinmis[yeniPrefix+k.slice(prefix.length)] = silinmis[k]; delete silinmis[k];
    });
    // malzemeMeta
    Object.keys(malzemeMeta).filter(k=>k.startsWith(prefix)).forEach(k=>{
      malzemeMeta[yeniPrefix+k.slice(prefix.length)] = malzemeMeta[k]; delete malzemeMeta[k];
    });
  }

  // ayarlar.depoYeniadlar — orijinal ad → şu anki ad eşlemesini sakla
  if(!ayarlar.depoYeniadlar) ayarlar.depoYeniadlar={};
  // eskiAd zaten başka bir rename'in sonucu olabilir; orijinalini bul
  const origAd = Object.entries(ayarlar.depoYeniadlar).find(([,v])=>v===eskiAd)?.[0] || eskiAd;
  if(yeniAd !== origAd) ayarlar.depoYeniadlar[origAd]=yeniAd;
  else delete ayarlar.depoYeniadlar[origAd];

  ayarlariKaydet(); apiSave(); initDepoSelects(); renderAyarlar();
  toast(yeniAd+' güncellendi ✓');
}

// ── Mevcut (built-in) kategori adı düzenleme ─────────────────────────────────
function katBuiltinEdit(eskiAd, idx) {
  const cc = KAT_COLORS[eskiAd]; if(!cc) return;
  const el = document.getElementById('kat-bi-'+idx); if(!el) return;
  el.innerHTML = `
    <input type="text"  id="edit-bi-kat-ad-${idx}"  value="${esc(eskiAd)}" placeholder="Kategori adı"
      style="flex:1;min-width:110px;padding:4px 8px;border:1.5px solid var(--teal);border-radius:6px;font-size:12px">
    <input type="color" id="edit-bi-kat-c-${idx}"   value="${cc.c}"  class="ayar-color-inp" title="Yazı">
    <input type="color" id="edit-bi-kat-bg-${idx}"  value="${cc.bg}" class="ayar-color-inp" title="Arkaplan">
    <button class="btn btn-primary btn-sm" onclick="katBuiltinGuncelle('${escQ(eskiAd)}',${idx})">✓</button>
    <button class="btn btn-outline btn-sm" onclick="renderAyarlar()">✕</button>`;
}
function katBuiltinGuncelle(eskiAd, idx) {
  const yeniAd = (document.getElementById('edit-bi-kat-ad-'+idx)?.value||'').trim();
  const yeniC  = document.getElementById('edit-bi-kat-c-'+idx)?.value  || KAT_COLORS[eskiAd]?.c;
  const yeniBg = document.getElementById('edit-bi-kat-bg-'+idx)?.value || KAT_COLORS[eskiAd]?.bg;
  if(!yeniAd){toast('Kategori adı zorunlu','error');return;}
  if(yeniAd!==eskiAd&&KAT_COLORS[yeniAd]){toast('Bu kategori zaten var','error');return;}

  // KAT_COLORS güncelle
  delete KAT_COLORS[eskiAd];
  KAT_COLORS[yeniAd]={c:yeniC, bg:yeniBg};

  // malzemeMeta içindeki kategori referanslarını güncelle
  if(yeniAd !== eskiAd) {
    Object.values(malzemeMeta).forEach(m=>{ if(m.kategori===eskiAd) m.kategori=yeniAd; });
  }

  // ayarlar.katYeniadlar — orijinal ad → şu anki ad
  if(!ayarlar.katYeniadlar) ayarlar.katYeniadlar={};
  const origAd = Object.entries(ayarlar.katYeniadlar).find(([,v])=>v===eskiAd)?.[0] || eskiAd;
  if(yeniAd !== origAd) ayarlar.katYeniadlar[origAd]=yeniAd;
  else delete ayarlar.katYeniadlar[origAd];

  ayarlariKaydet(); apiSave(); initKatSelects(); renderAyarlar();
  toast(yeniAd+' güncellendi ✓');
}

function katEkle() {
  const ad  = (document.getElementById('yeni-kat-ad')?.value||'').trim();
  const c   = document.getElementById('yeni-kat-renk-c')?.value||'#546e7a';
  const bg  = document.getElementById('yeni-kat-renk-bg')?.value||'#eceff1';
  if (!ad) { toast('Kategori adı zorunlu','error'); return; }
  if (KAT_COLORS[ad]) { toast('Bu kategori zaten var','error'); return; }
  if (!ayarlar.ekKategori) ayarlar.ekKategori=[];
  ayarlar.ekKategori.push({ad,c,bg});
  KAT_COLORS[ad]={c,bg};
  ayarlariKaydet(); initKatSelects(); renderAyarlar();
  toast(ad+' eklendi ✓');
}
function katSil(i) {
  const k=(ayarlar.ekKategori||[])[i]; if(!k) return;
  if (!confirm(`"${k.ad}" kategorisini silmek istediğinizden emin misiniz?`)) return;
  delete KAT_COLORS[k.ad];
  ayarlar.ekKategori.splice(i,1);
  ayarlariKaydet(); initKatSelects(); renderAyarlar();
  toast(k.ad+' kaldırıldı');
}
function katEdit(i) {
  const k=(ayarlar.ekKategori||[])[i]; if(!k) return;
  const el=document.getElementById('kat-item-'+i); if(!el) return;
  el.innerHTML=`
    <input type="text" id="edit-kat-ad-${i}" value="${k.ad}" placeholder="Kategori adı" style="flex:1;min-width:100px;padding:4px 8px;border:1.5px solid var(--teal);border-radius:6px;font-size:12px">
    <input type="color" id="edit-kat-c-${i}" value="${k.c}" class="ayar-color-inp" title="Yazı rengi">
    <input type="color" id="edit-kat-bg-${i}" value="${k.bg}" class="ayar-color-inp" title="Arka plan">
    <button class="btn btn-primary btn-sm" onclick="katGuncelle(${i})">✓</button>
    <button class="btn btn-outline btn-sm" onclick="renderAyarlar()">✕</button>`;
}
function katGuncelle(i) {
  const k=(ayarlar.ekKategori||[])[i]; if(!k) return;
  const eskiAd=k.ad;
  const yeniAd=(document.getElementById('edit-kat-ad-'+i)?.value||'').trim();
  const yeniC=document.getElementById('edit-kat-c-'+i)?.value||k.c;
  const yeniBg=document.getElementById('edit-kat-bg-'+i)?.value||k.bg;
  if(!yeniAd){toast('Kategori adı zorunlu','error');return;}
  if(yeniAd!==eskiAd&&KAT_COLORS[yeniAd]){toast('Bu kategori zaten var','error');return;}
  delete KAT_COLORS[eskiAd];
  KAT_COLORS[yeniAd]={c:yeniC,bg:yeniBg};
  k.ad=yeniAd; k.c=yeniC; k.bg=yeniBg;
  ayarlariKaydet(); initKatSelects(); renderAyarlar();
  toast(yeniAd+' güncellendi ✓');
}

// ── Yeni renderAyarlar için yardımcı fonksiyonlar ─────────────────────────────
function ekDepoEkle() {
  const ad    = (document.getElementById('yd-ad')?.value||'').trim();
  const kod   = (document.getElementById('yd-kod')?.value||'').trim().toUpperCase();
  const color = document.getElementById('yd-renk')?.value||'#546e7a';
  if (!ad||!kod) { toast('Ad ve kod zorunlu','error'); return; }
  if (DEPO_META[ad]) { toast('Bu depo zaten var','error'); return; }
  if (!ayarlar.ekDepo) ayarlar.ekDepo=[];
  ayarlar.ekDepo.push({ad,kod,color});
  DEPO_META[ad]={kod,cls:'',color}; DEPO_BADGE[ad]='';
  ayarlariKaydet(); initDepoSelects(); renderAyarlar();
  toast(ad+' eklendi ✓');
}
function depoYeniAdDlg(eskiAd) {
  const m = DEPO_META[eskiAd]; if(!m) return;
  const form = document.getElementById('depo-yeniad-form'); if(!form) return;
  form.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding:10px;background:var(--bg);border-radius:8px">
    <strong style="width:100%;font-size:12px;margin-bottom:4px">${esc(eskiAd)} düzenle</strong>
    <input type="text" id="dyn-ad" value="${esc(eskiAd)}" placeholder="Depo adı" class="ayar-input" style="max-width:160px">
    <input type="text" id="dyn-kod" value="${esc(m.kod)}" maxlength="4" placeholder="Kod" class="ayar-input" style="max-width:80px">
    <input type="color" id="dyn-renk" value="${m.color}" style="width:38px;height:32px;padding:2px;border:1px solid var(--line);border-radius:6px;cursor:pointer">
    <button class="btn btn-sm btn-primary" onclick="depoYeniAdKaydet('${escQ(eskiAd)}')">✓ Kaydet</button>
    <button class="btn btn-sm btn-outline" onclick="renderAyarlar()">✕</button>
  </div>`;
}
function depoYeniAdKaydet(eskiAd) {
  const yeniAd   = (document.getElementById('dyn-ad')?.value||'').trim();
  const yeniKod  = (document.getElementById('dyn-kod')?.value||'').trim().toUpperCase();
  const yeniRenk = document.getElementById('dyn-renk')?.value || DEPO_META[eskiAd]?.color;
  if(!yeniAd||!yeniKod){toast('Ad ve kod zorunlu','error');return;}
  if(yeniAd!==eskiAd&&DEPO_META[yeniAd]){toast('Bu depo adı zaten var','error');return;}
  const meta = { ...DEPO_META[eskiAd], kod:yeniKod, color:yeniRenk };
  delete DEPO_META[eskiAd]; DEPO_META[yeniAd] = meta;
  const badge = DEPO_BADGE[eskiAd]; delete DEPO_BADGE[eskiAd]; DEPO_BADGE[yeniAd] = badge||'';
  if(yeniAd !== eskiAd) {
    const prefix = eskiAd+'||'; const yeniPrefix = yeniAd+'||';
    const renameObj = obj => { Object.keys(obj).filter(k=>k.startsWith(prefix)).forEach(k=>{ obj[yeniPrefix+k.slice(prefix.length)]=obj[k]; delete obj[k]; }); };
    renameObj(stok); renameObj(ozelMalzeme); renameObj(silinmis); renameObj(malzemeMeta);
    hareketler.forEach(h=>{ if(h.depo===eskiAd) h.depo=yeniAd; });
    const ekD = (ayarlar.ekDepo||[]).find(d=>d.ad===eskiAd); if(ekD) ekD.ad=yeniAd;
    if(!ayarlar.depoYeniadlar) ayarlar.depoYeniadlar={};
    const origKey = Object.entries(ayarlar.depoYeniadlar||{}).find(([,v])=>v===eskiAd)?.[0] || eskiAd;
    if(origKey!==yeniAd) ayarlar.depoYeniadlar[origKey]=yeniAd; else delete ayarlar.depoYeniadlar[origKey];
  }
  ayarlariKaydet(); apiSave(); initDepoSelects(); renderAyarlar();
  toast(yeniAd+' güncellendi ✓');
}
function ekKatEkle() {
  const ad  = (document.getElementById('yk-ad')?.value||'').trim();
  const c   = document.getElementById('yk-renk-c')?.value||'#546e7a';
  const bg  = document.getElementById('yk-renk-bg')?.value||'#eceff1';
  if (!ad) { toast('Kategori adı zorunlu','error'); return; }
  if (KAT_COLORS[ad]) { toast('Bu kategori zaten var','error'); return; }
  if (!ayarlar.ekKategori) ayarlar.ekKategori=[];
  ayarlar.ekKategori.push({ad,c,bg});
  KAT_COLORS[ad]={c,bg};
  ayarlariKaydet(); initKatSelects(); renderAyarlar();
  toast(ad+' eklendi ✓');
}
function katYeniAdDlg(eskiAd) {
  const cc = KAT_COLORS[eskiAd]; if(!cc) return;
  const form = document.getElementById('kat-yeniad-form'); if(!form) return;
  form.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding:10px;background:var(--bg);border-radius:8px">
    <strong style="width:100%;font-size:12px;margin-bottom:4px">${esc(eskiAd)} düzenle</strong>
    <input type="text" id="kyn-ad" value="${esc(eskiAd)}" placeholder="Kategori adı" class="ayar-input" style="max-width:160px">
    <input type="color" id="kyn-c" value="${cc.c}" style="width:38px;height:32px;padding:2px;border:1px solid var(--line);border-radius:6px;cursor:pointer" title="Yazı rengi">
    <input type="color" id="kyn-bg" value="${cc.bg}" style="width:38px;height:32px;padding:2px;border:1px solid var(--line);border-radius:6px;cursor:pointer" title="Arkaplan">
    <button class="btn btn-sm btn-primary" onclick="katYeniAdKaydet('${escQ(eskiAd)}')">✓ Kaydet</button>
    <button class="btn btn-sm btn-outline" onclick="renderAyarlar()">✕</button>
  </div>`;
}
function katYeniAdKaydet(eskiAd) {
  const yeniAd = (document.getElementById('kyn-ad')?.value||'').trim();
  const yeniC  = document.getElementById('kyn-c')?.value || KAT_COLORS[eskiAd]?.c;
  const yeniBg = document.getElementById('kyn-bg')?.value || KAT_COLORS[eskiAd]?.bg;
  if(!yeniAd){toast('Kategori adı zorunlu','error');return;}
  if(yeniAd!==eskiAd&&KAT_COLORS[yeniAd]){toast('Bu kategori zaten var','error');return;}
  delete KAT_COLORS[eskiAd]; KAT_COLORS[yeniAd]={c:yeniC,bg:yeniBg};
  const ekK = (ayarlar.ekKategori||[]).find(k=>k.ad===eskiAd); if(ekK) ekK.ad=yeniAd;
  if(!ayarlar.katYeniadlar) ayarlar.katYeniadlar={};
  const origKey = Object.entries(ayarlar.katYeniadlar||{}).find(([,v])=>v===eskiAd)?.[0] || eskiAd;
  if(origKey!==yeniAd) ayarlar.katYeniadlar[origKey]=yeniAd; else delete ayarlar.katYeniadlar[origKey];
  ayarlariKaydet(); initKatSelects(); renderAyarlar();
  toast(yeniAd+' güncellendi ✓');
}

function veriSifirla() {
  if (!confirm('Tüm stok, hareket ve özel malzeme verileri silinecek.\nDevam etmek istediğinizden emin misiniz?')) return;
  stok={};hareketler=[];ozelMalzeme={};silinmis={};malzemeMeta={};
  apiReset();
  refreshAll();
  refreshVeriYonet();
  toast('Tüm veriler sıfırlandı.');
}

// ═══════════════════════════════════════════════════════════════════
// TALEPNAME
// ═══════════════════════════════════════════════════════════════════

function talepListesiYukle() {
  try { _talepListesi = JSON.parse(localStorage.getItem('talepListesi') || '[]'); }
  catch(e) { _talepListesi = []; }
}
function talepListesiKaydet() {
  localStorage.setItem('talepListesi', JSON.stringify(_talepListesi));
}

// ── Malzeme Seçici Modal ──────────────────────────────────────────
let _talepMalListesi  = [];
let _talepMalModalN   = null;
let _talepMalModalDep = 'Tümü';

function _buildTalepMalListesi() {
  return getAllItems()
    .filter(i => !silinmis[getKey(i.depo, i.ad)])
    .map(i => {
      const s  = getStok(i.depo, i.ad);
      const mm = malzemeMeta[getKey(i.depo, i.ad)] || {};
      const d  = durum(s.mevcut, s.min, s.max);
      return { val: i.depo+'||'+i.ad, ad: i.ad, depo: i.depo,
               birim: mm.birim||'', mevcut: s.mevcut, min: s.min, durum: d };
    });
}

function talepMalModalAc(n) {
  _talepMalListesi = _buildTalepMalListesi();
  _talepMalModalN  = n;
  _talepMalModalDep = 'Tümü';
  const ara = document.getElementById('mal-sec-ara');
  if (ara) ara.value = '';
  // Depo chip'leri oluştur
  const depolar = ['Tümü', ...new Set(_talepMalListesi.map(m => m.depo))];
  const chipsEl = document.getElementById('mal-sec-depo-chips');
  if (chipsEl) {
    chipsEl.innerHTML = depolar.map(d =>
      `<div class="filter-chip${d==='Tümü'?' active':''}" onclick="_talepMalDepuSec('${escQ(d)}'); return false">${esc(d)}</div>`
    ).join('');
  }
  _talepMalModalRender();
  document.getElementById('modal-mal-sec').classList.add('open');
  setTimeout(() => { if (ara) ara.focus(); }, 80);
}

function _talepMalDepuSec(dep) {
  _talepMalModalDep = dep;
  document.querySelectorAll('#mal-sec-depo-chips .filter-chip')
    .forEach(c => c.classList.toggle('active', c.textContent === dep));
  _talepMalModalRender();
}

function _talepMalModalRender() {
  const q    = (document.getElementById('mal-sec-ara')?.value || '').toLowerCase().trim();
  const dep  = _talepMalModalDep;
  let liste  = _talepMalListesi;
  if (dep !== 'Tümü') liste = liste.filter(m => m.depo === dep);
  if (q) liste = liste.filter(m => m.ad.toLowerCase().includes(q) || m.depo.toLowerCase().includes(q));
  const listeEl = document.getElementById('mal-sec-liste');
  if (!listeEl) return;
  if (!liste.length) {
    listeEl.innerHTML = '<div class="mal-sec-empty">Sonuç bulunamadı</div>';
    return;
  }
  listeEl.innerHTML = liste.map(m => {
    const bir  = m.birim || 'adet';
    const krit = m.durum === 'Kritik';
    return `<div class="mal-sec-item" onclick="_talepMalModalSec('${escQ(m.val)}','${escQ(m.ad)}','${escQ(m.depo)}','${escQ(m.birim)}',${m.mevcut},${m.min})">
      <div class="mal-sec-ad">${esc(m.ad)}</div>
      <div class="mal-sec-meta">
        ${depoBadge(m.depo)}
        <span class="mal-sec-stok${krit?' krit':''}">${m.mevcut} ${esc(bir)}${krit?' ⚠':''}</span>
      </div>
    </div>`;
  }).join('');
}

function _talepMalModalSec(val, ad, dep, birim, mevcut, min) {
  closeModal('modal-mal-sec');
  _talepMalApply(_talepMalModalN, val, ad, dep, birim, mevcut, min);
}

function _talepMalApply(n, val, ad, dep, birim, mevcut, min) {
  const hid = document.getElementById('talep-hid-'+n);
  if (hid) hid.value = val;
  const cell = document.getElementById('talep-combo-'+n);
  if (cell) {
    cell.innerHTML = `<div class="talep-mal-secili">
      <span class="talep-mal-ad" onclick="talepMalModalAc(${n})" title="Değiştirmek için tıklayın">${esc(ad)}</span>
      <button class="talep-mal-temizle" type="button" onclick="talepMalTemizle(${n})">×</button>
    </div>`;
  }
  const tr = document.getElementById('talep-satir-'+n);
  if (tr) {
    const depEl  = tr.querySelector('.t-depo-cell');
    const birInp = tr.querySelector('.talep-birim');
    const mevEl  = tr.querySelector('.t-mevcut-cell');
    const mikInp = tr.querySelector('.talep-miktar');
    if (depEl)  depEl.innerHTML = depoBadge(dep);
    if (birInp) birInp.value   = birim || 'adet';
    const kritik = mevcut <= min;
    if (mevEl) mevEl.innerHTML = `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:${kritik?'var(--red)':'var(--ink2)'}">${mevcut}${kritik?' ⚠':''}</span>`;
    if (mikInp && kritik && !mikInp.value)
      mikInp.value = Math.max(1, min - mevcut + 1);
  }
  updateTalepToplam();
}

function talepMalTemizle(n) {
  const hid = document.getElementById('talep-hid-'+n);
  if (hid) hid.value = '';
  const cell = document.getElementById('talep-combo-'+n);
  if (cell) cell.innerHTML = `<button class="talep-mal-btn" type="button" onclick="talepMalModalAc(${n})">📦 Malzeme Seç</button>`;
  _talepSatirInfoTemizle(n);
  updateTalepToplam();
}
function _talepSatirInfoTemizle(n) {
  const tr = document.getElementById('talep-satir-'+n);
  if (!tr) return;
  const depEl = tr.querySelector('.t-depo-cell');
  const mevEl = tr.querySelector('.t-mevcut-cell');
  if (depEl) depEl.innerHTML = '';
  if (mevEl) mevEl.innerHTML = '';
}

// Sidebar ↔ kağıt metasını senkronize eder (baskı için kağıt ID'leri güncellenir)
function _talepMetaMirror() {
  const docNo   = document.getElementById('talep-no-display-doc');
  const docDate = document.getElementById('talep-tarih-display-doc');
  if (docNo)   docNo.textContent   = document.getElementById('talep-no-display')?.textContent   || '—';
  if (docDate) docDate.textContent = document.getElementById('talep-tarih-display')?.textContent || '';
}

// ── Talep formu init ──────────────────────────────────────────────
async function initTalep() {
  const kEl = document.getElementById('talep-form-kurum');
  if (kEl) kEl.textContent = ayarlar.kurumAdi || 'DYS – Depo Yönetim Sistemi';
  // Sidebar → paper senkronizasyonu için MutationObserver
  ['talep-no-display','talep-tarih-display'].forEach(id => {
    const el = document.getElementById(id);
    if (el) new MutationObserver(_talepMetaMirror).observe(el, {childList:true,subtree:true,characterData:true});
  });

  if (_viewTalep) {
    const t = _viewTalep; _viewTalep = null;
    talepSatirCount = 0;
    document.getElementById('talep-tbody').innerHTML = '';
    document.getElementById('talep-no-display').textContent    = t.no;
    document.getElementById('talep-tarih-display').textContent = t.tarih;
    document.getElementById('t-birim').value    = t.birim    || '';
    document.getElementById('t-personel').value = t.personel || '';
    const acEl = document.getElementById('t-aciliyet');
    acEl.value = t.aciliyet || 'Normal';
    talepAciliyetGuncelle(acEl);
    document.getElementById('t-gerekce').value  = t.gerekce  || '';
    document.getElementById('imza1').value = t.imza1 || '';
    document.getElementById('imza2').value = t.imza2 || '';
    document.getElementById('imza3').value = t.imza3 || '';
    _talepMalListesi = _buildTalepMalListesi();
    (t.satirlar || []).filter(s => s.ad).forEach(s => {
      talepSatirEkle(s.depo + '||' + s.ad);
      const tr = document.getElementById('talep-satir-' + talepSatirCount);
      if (tr) {
        const mikInp   = tr.querySelector('.talep-miktar');
        const birimInp = tr.querySelector('.talep-birim');
        if (mikInp)   mikInp.value   = s.miktar || 0;
        if (birimInp) birimInp.value = s.birim  || '';
      }
    });
    if (talepSatirCount === 0) talepSatirEkle();
    _talepDurumGoster(t.durum || 'Taslak');
    updateTalepToplam();
    return;
  }
  if (talepSatirCount === 0) {
    await yeniTalepno();
    if (_pendingKritikler) {
      const list = _pendingKritikler;
      _pendingKritikler = null;
      list.forEach(k => {
        talepSatirEkle(k.depo + '||' + k.ad);
        const tr = document.getElementById('talep-satir-' + talepSatirCount);
        if (tr) {
          const mikInp = tr.querySelector('.talep-miktar');
          if (mikInp) mikInp.value = Math.max(1, k.min - k.mevcut + 1);
        }
      });
      updateTalepToplam();
      toast(`${list.length} kritik malzeme talepnameye aktarıldı ✓`);
    } else {
      for (let i=0;i<5;i++) talepSatirEkle();
    }
    if (ayarlar.talepSahibi)     { const el=document.getElementById('t-personel'); if(el&&!el.value) el.value=ayarlar.talepSahibi; }
    if (ayarlar.talepOnaylayan1) { const el=document.getElementById('imza1');      if(el&&!el.value) el.value=ayarlar.talepOnaylayan1; }
    if (ayarlar.talepOnaylayan2) { const el=document.getElementById('imza2');      if(el&&!el.value) el.value=ayarlar.talepOnaylayan2; }
    if (ayarlar.talepOnaylayan3) { const el=document.getElementById('imza3');      if(el&&!el.value) el.value=ayarlar.talepOnaylayan3; }
    _talepDurumGoster('Taslak');
  }
}

async function yeniTalepno() {
  let no;
  if (API_MOD) {
    try {
      const r = await apiFetch(API_URL+'?action=talep_no');
      const j = await r.json();
      if (j.ok) no = j.no;
    } catch(e) { console.warn('talep_no:', e); }
  }
  if (!no) { talepNo++; no = (ayarlar.talepOnPek||'TLN')+'-'+String(talepNo).padStart(4,'0'); }
  document.getElementById('talep-no-display').textContent = no;
  document.getElementById('talep-tarih-display').textContent = fmtGun(new Date());
}

function talepKaydet(durum = 'Taslak') {
  const no    = document.getElementById('talep-no-display')?.textContent||'';
  const tarih = document.getElementById('talep-tarih-display')?.textContent||'';
  const satirlar = [];
  document.querySelectorAll('#talep-tbody tr').forEach(tr => {
    const hid    = tr.querySelector('[id^="talep-hid-"]');
    const inp    = tr.querySelector('[id^="talep-inp-"]');
    const birim  = tr.querySelector('.talep-birim');
    const miktar = tr.querySelector('.talep-miktar');
    const mik    = parseInt(miktar?.value);
    if (!Number.isFinite(mik) || mik <= 0) return;
    if (hid?.value) {
      const [dep, ad] = hid.value.split('||');
      satirlar.push({ ad, depo: dep, birim: birim?.value||'', miktar: mik });
    } else if (inp?.value.trim()) {
      satirlar.push({ ad: inp.value.trim(), depo: '', birim: birim?.value||'', miktar: mik });
    }
  });
  if (!satirlar.length) { toast('En az 1 malzeme ve geçerli miktar girin','error'); return; }
  const payload = {
    no, tarih, durum,
    birim   : document.getElementById('t-birim')?.value||'',
    personel: document.getElementById('t-personel')?.value||'',
    aciliyet: document.getElementById('t-aciliyet')?.value||'Normal',
    gerekce : document.getElementById('t-gerekce')?.value||'',
    satirlar,
    imza1: document.getElementById('imza1')?.value||'',
    imza2: document.getElementById('imza2')?.value||'',
    imza3: document.getElementById('imza3')?.value||'',
  };
  talepListesiYukle();
  const idx = _talepListesi.findIndex(t => t.no === no);
  if (idx >= 0) { _talepListesi[idx] = { ..._talepListesi[idx], ...payload }; }
  else          { payload.id = Date.now(); _talepListesi.push(payload); }
  talepListesiKaydet();
  if (API_MOD) {
    apiFetch(API_URL+'?action=talep_kaydet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(r=>r.json()).then(j=>{
        if (j.ok && j.no) document.getElementById('talep-no-display').textContent = j.no;
        else if (!j.ok) toast('Talep sunucuya kaydedilemedi: ' + (j.error||''), 'error');
      })
      .catch(e => { console.warn('talep_kaydet:', e); toast('Sunucuya kaydedilemedi, yerelde tutuldu', 'error'); });
  }
  const msg = durum==='Taslak' ? 'taslak olarak kaydedildi' : 'onaya gönderildi';
  toast(`Talep ${no} ${msg} ✓`);
  _talepDurumGoster(durum);
}

function talepAyarlaraKaydet() {
  const personel = document.getElementById('t-personel')?.value.trim();
  const imza1    = document.getElementById('imza1')?.value.trim();
  const imza2    = document.getElementById('imza2')?.value.trim();
  const imza3    = document.getElementById('imza3')?.value.trim();
  if (personel) ayarlar.talepSahibi      = personel;
  if (imza1)    ayarlar.talepOnaylayan1  = imza1;
  if (imza2)    ayarlar.talepOnaylayan2  = imza2;
  if (imza3)    ayarlar.talepOnaylayan3  = imza3;
  ayarlariKaydet();
  toast('Personel ve imza bilgileri ayarlara kaydedildi ✓');
}

function talepOnayaGonder() {
  talepKaydet('Onay Bekliyor');
}

function talepSifirla() {
  talepSatirCount = 0;
  document.getElementById('talep-tbody').innerHTML = '';
  ['t-birim','t-personel','t-gerekce','imza1','imza2','imza3'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const acEl = document.getElementById('t-aciliyet'); if (acEl) { acEl.value = 'Normal'; talepAciliyetGuncelle(acEl); }
  yeniTalepno().then(() => {
    for (let i=0;i<5;i++) talepSatirEkle();
    if (ayarlar.talepSahibi)     { const el=document.getElementById('t-personel'); if(el) el.value=ayarlar.talepSahibi; }
    if (ayarlar.talepOnaylayan1) { const el=document.getElementById('imza1');      if(el) el.value=ayarlar.talepOnaylayan1; }
    if (ayarlar.talepOnaylayan2) { const el=document.getElementById('imza2');      if(el) el.value=ayarlar.talepOnaylayan2; }
    if (ayarlar.talepOnaylayan3) { const el=document.getElementById('imza3');      if(el) el.value=ayarlar.talepOnaylayan3; }
    _talepDurumGoster('Taslak');
    updateTalepToplam();
  });
}

function _talepDurumGoster(durum) {
  const el = document.getElementById('talep-durum-badge');
  if (!el) return;
  const cls = { 'Taslak':'taslak','Onay Bekliyor':'onay-bekliyor','Onaylı':'onayli','Reddedildi':'reddedildi' };
  el.innerHTML = durum ? `<span class="talep-durum-badge ${cls[durum]||'taslak'}">${durum}</span>` : '';
  // Damgayı güncelle
  const stamp = document.getElementById('ts-stamp');
  const stampTxt = document.getElementById('ts-stamp-text');
  if (stamp && stampTxt) {
    stamp.className = 'ts-stamp';
    const stamps = {'Taslak':'ts-stamp-taslak','Onay Bekliyor':'ts-stamp-onay','Onaylı':'ts-stamp-onayli','Reddedildi':'ts-stamp-red'};
    stamp.classList.add(stamps[durum] || 'ts-stamp-taslak');
    const labels = {'Taslak':'TASLAK','Onay Bekliyor':'ONAY\nBEKLİYOR','Onaylı':'ONAYLANDI','Reddedildi':'REDDEDİLDİ'};
    stampTxt.textContent = labels[durum] || durum;
  }
}

// ── Talep Listesi ──────────────────────────────────────────────────────────────
function renderTalepListesi() {
  const el = document.getElementById('talep-listesi-icerik');
  if (!el) return;
  talepListesiYukle();
  const durumFilter = document.getElementById('tl-durum-filter')?.value || '';
  const liste = [..._talepListesi].reverse().filter(t => !durumFilter || t.durum === durumFilter);
  if (!liste.length) {
    el.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--muted);font-size:13px">Kayıtlı talep bulunamadı.</p></div></div>';
    return;
  }
  const acilRenk = { 'Normal':'var(--ink2)', 'Acil':'var(--amber)', 'Çok Acil':'var(--red)' };
  const durumCls = d => ({ 'Taslak':'taslak','Onay Bekliyor':'onay-bekliyor','Onaylı':'onayli','Reddedildi':'reddedildi' }[d]||'taslak');
  el.innerHTML = `<div class="card" style="overflow:hidden"><div style="overflow-x:auto">
    <table id="talep-list-table">
      <thead><tr>
        <th>Talep No</th><th>Tarih</th><th>Birim</th><th>Personel</th>
        <th>Aciliyet</th><th style="text-align:center">Kalem</th>
        <th>Durum</th><th></th>
      </tr></thead>
      <tbody>
      ${liste.map(t => {
        const kalem = (t.satirlar||[]).filter(s=>s.ad).length;
        const d = t.durum || 'Taslak';
        const bekliyor = d === 'Onay Bekliyor';
        return `<tr>
          <td><strong style="font-family:'IBM Plex Mono',monospace;font-size:12px">${esc(t.no)}</strong></td>
          <td style="font-size:12px">${esc(t.tarih||'—')}</td>
          <td>${esc(t.birim||'—')}</td>
          <td>${esc(t.personel||'—')}</td>
          <td style="color:${acilRenk[t.aciliyet]||'var(--ink2)'}"><strong>${esc(t.aciliyet||'Normal')}</strong></td>
          <td style="text-align:center">${kalem}</td>
          <td><span class="talep-durum-badge ${durumCls(d)}">${esc(d)}</span></td>
          <td style="text-align:right;white-space:nowrap;display:flex;gap:4px;justify-content:flex-end">
            ${bekliyor ? `<button class="btn btn-sm" style="background:color-mix(in srgb,var(--teal) 12%,transparent);color:var(--teal);border:1px solid var(--teal)" onclick="talepDurumGuncelle(${t.id},'Onaylı')">✓ Onayla</button>
              <button class="btn btn-sm" style="background:color-mix(in srgb,var(--red) 10%,transparent);color:var(--red);border:1px solid var(--red)" onclick="talepDurumGuncelle(${t.id},'Reddedildi')">✕ Reddet</button>` : ''}
            <button class="btn btn-sm btn-outline" onclick="talepGoruntule(${t.id})">👁 Görüntüle</button>
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
  </div></div>`;
  if (API_MOD) {
    apiFetch(API_URL+'?action=talep_list').then(r=>r.json()).then(j=>{
      if (j.ok && j.talepler?.length) {
        j.talepler.forEach(at => { if (!_talepListesi.find(x=>x.no===at.no)) _talepListesi.push({...at}); });
        talepListesiKaydet();
      }
    }).catch(e => { console.warn('talep_list:', e); });
  }
}

function talepDurumGuncelle(id, yeniDurum) {
  talepListesiYukle();
  const t = _talepListesi.find(x => x.id === id);
  if (t) { t.durum = yeniDurum; talepListesiKaydet(); toast(`Durum → ${yeniDurum} ✓`); renderTalepListesi(); }
  if (API_MOD) {
    apiFetch(API_URL+'?action=talep_durum',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,durum:yeniDurum})})
      .then(r=>r.json()).then(j=>{ if(!j.ok) toast('Durum sunucuya yansıtılamadı: '+(j.error||''), 'error'); })
      .catch(e => { console.warn('talep_durum:', e); toast('Sunucu bağlantı hatası', 'error'); });
  }
}

function talepGoruntule(id) {
  const t = _talepListesi.find(x => x.id === id);
  if (!t) { toast('Talep bulunamadı', 'error'); return; }
  _viewTalep = t;
  talepSatirCount = 0;
  navigate('talep');
}

function talepSatirEkle(malzemeVal) {
  talepSatirCount++;
  const tbody = document.getElementById('talep-tbody');
  const tr = document.createElement('tr');
  tr.id = 'talep-satir-' + talepSatirCount;
  const n = talepSatirCount;
  tr.innerHTML = `
    <td style="text-align:center;color:var(--muted);font-family:'IBM Plex Mono',monospace;font-size:11px">${n}</td>
    <td style="min-width:180px">
      <input type="hidden" id="talep-hid-${n}" value="">
      <div class="talep-mal-cell" id="talep-combo-${n}">
        <button class="talep-mal-btn" type="button" onclick="talepMalModalAc(${n})">📦 Malzeme Seç</button>
      </div>
    </td>
    <td class="t-depo-cell"></td>
    <td><input type="text" class="talep-birim" placeholder="adet" style="width:100%"></td>
    <td class="t-mevcut-cell" style="text-align:center"></td>
    <td><input type="number" class="talep-miktar" min="0" placeholder="0" oninput="updateTalepToplam()"></td>
    <td class="no-print" style="text-align:center">
      <button onclick="talepSatirSil(${n})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px">×</button>
    </td>`;
  tbody.appendChild(tr);
  if (malzemeVal) {
    if (!_talepMalListesi.length) _talepMalListesi = _buildTalepMalListesi();
    const m = _talepMalListesi.find(x => x.val === malzemeVal);
    if (m) _talepMalApply(n, m.val, m.ad, m.depo, m.birim, m.mevcut, m.min);
  }
  updateTalepToplam();
}

function talepSatirSil(n) {
  const tr = document.getElementById('talep-satir-' + n);
  if (!tr) return;
  const hid = tr.querySelector('[id^="talep-hid-"]');
  const inp = tr.querySelector('[id^="talep-inp-"]');
  const val = hid?.value || inp?.value.trim();
  if (val && !confirm('Bu satırı silmek istediğinizden emin misiniz?')) return;
  tr.remove();
  updateTalepToplam();
}

function updateTalepToplam() {}

function talepAciliyetGuncelle(sel) {
  sel.className = '';
  if (sel.value === 'Acil')      sel.className = 'talep-aciliyet-acil';
  if (sel.value === 'Çok Acil')  sel.className = 'talep-aciliyet-cokacil';
}



// ── Stok Başlangıç Miktarları (12.03.2026 sayımı) ──────────────
const STOK_INIT = {"Temizlik Deposu||Pas ve Kireç Sökücü 30 kg": 5, "Temizlik Deposu||Çamaşır Suyu 30 kg": 12, "Temizlik Deposu||Sıvı Bulaşık Deterjanı": 3, "Temizlik Deposu||Sıvı El Sabunu": 3, "Temizlik Deposu||Köpük Sabun": 10, "Temizlik Deposu||Köpük Verici Sabunluk": 1, "Temizlik Deposu||Katı Sabun (4'lü paket)": 16, "Temizlik Deposu||Tex krem temizleyici": 5, "Temizlik Deposu||Asperox Sarı Güç (1 litre)": 16, "Temizlik Deposu||Lavabo Açıcı Asit (1 litre)": 23, "Temizlik Deposu||Beyaz Sirke (1 litre)": 24, "Temizlik Deposu||Oluklu Bulaşık Süngeri (5'li paket)": 18, "Temizlik Deposu||Tuvalet Gider Kapağı": 8, "Temizlik Deposu||Makarna Mop": 17, "Temizlik Deposu||Mop aparatı (palet)": 4, "Temizlik Deposu||Ahşap Mop Sapı": 4, "Temizlik Deposu||Fırça-Faraş seti": 9, "Temizlik Deposu||Temizlik Bezi": 54, "Temizlik Deposu||Çekpas ucu": 9, "Temizlik Deposu||Lavabo fırçası": 14, "Temizlik Deposu||Tüylü Fırça": 2, "Temizlik Deposu||Bulaşık eldiveni": 1, "Temizlik Deposu||Otomatik Havlu Kağıdı (6'lı rulo)": 23, "Temizlik Deposu||Tuvalet Kağıdı (32'li rulo)": 21, "Temizlik Deposu||Kağıt Havlu (12'li rulo)": 17, "Temizlik Deposu||Mavi Çöp Torbası (65*80 organik atık) kolide 50 rulo": 15, "Temizlik Deposu||Siyah Çöp Torbası (80*110) kolide 20 rulo": 10, "Temizlik Deposu||Kırmızı Tıbbi Atık Torbası (80*110 kolide 10 rulo)": 71, "Temizlik Deposu||Kırmızı Tıbbi Atık Torbası (75*90 kolide 15 rulo)": 33, "Temizlik Deposu||Mini boy Şeffaf Çöp Torbası (40*50 kolide 50 rulo)": 3, "Temizlik Deposu||5'lik şeffaf poşet (pakette 100 adet)": 4, "Temizlik Deposu||2'lik şeffaf poşet (pakette 300 adet)": 6, "Temizlik Deposu||1'lik şeffaf poşet (pakette 300 adet)": 9, "Temizlik Deposu||Yarım kiloluk şeffaf poşet (pakette 450 adet)": 3, "Temizlik Deposu||Kilitli Poşet 10*12 cm (kutuda 1000 adet)": 3, "Temizlik Deposu||Kilitli Poşet 11*14 cm (kutuda 1000 adet)": 1, "Temizlik Deposu||Kilitli Poşet 13*16 cm (kutuda 600 adet)": 3, "Temizlik Deposu||Kilitli Poşet 16*20 cm (kutuda 600 adet)": 1, "Temizlik Deposu||Kilitli Poşet 17*23 cm (kutuda 300 adet)": 3, "Temizlik Deposu||Kilitli Poşet 19*25 cm (kutuda 300 adet)": 4, "Temizlik Deposu||Zehirsiz Fare Yapışkanı": 14, "Temizlik Deposu||Metal Kova": 17, "Temizlik Deposu||Pedallı Çöp Kovası mini boy": 6, "Temizlik Deposu||Tıbbi Atık Kutusu": 36, "Temizlik Deposu||Eldiven XL kolide 20 adet": 32, "Temizlik Deposu||Eldiven L kolide 20 adet": 50, "Temizlik Deposu||Eldiven M (paket)": 31, "Temizlik Deposu||Galoşmatik Galoşu": 5, "Temizlik Deposu||Çizme Galoşu": 3, "Temizlik Deposu||Çizme": 7, "Temizlik Deposu||Kaydırmaz Çizme Galoşu": 2, "Temizlik Deposu||TYVEK Çizme Galoş (kutuda 200 adet)": 12, "Temizlik Deposu||TYVEK S Tulum (kolide 100 adet)": 1, "Temizlik Deposu||TYVEK M Tulum (kolide 100 adet)": 1, "Temizlik Deposu||TYVEK XL Tulum (kolide 100 adet)": 1, "Temizlik Deposu||Afyondan gelen tulumlar L beden": 7, "Temizlik Deposu||3M Maske": 9, "Temizlik Deposu||FFP3 3M Maske (pakette 10 adet)": 11, "Temizlik Deposu||FFP2 3M Maske (pakette 10 adet)": 32, "Temizlik Deposu||FFP2 Maske": 1, "Temizlik Deposu||FFP1 3M Maske (pakette 10 adet)": 6, "Temizlik Deposu||N95 3M Maske (pakette 20 adet)": 2, "Temizlik Deposu||Yerli Solunum Maskesi": 1, "Temizlik Deposu||Telli Maske": 15, "Temizlik Deposu||Pandemi RTE Maske (Defacto)": 16, "Temizlik Deposu||Koruyucu Gözlük": 5, "Temizlik Deposu||Mavi Önlük": 2, "Temizlik Deposu||Bone (pakette 1000 adet)": 3, "Temizlik Deposu||Şeffaf Saklama Kabı (kuduz için)": 7, "Temizlik Deposu||A4 Kâğıdı": 32, "Temizlik Deposu||A4 Telli Dosya (pakette 50 adet)": 18, "Temizlik Deposu||Koli Bandı (pakette 6 adet)": 3, "Temizlik Deposu||Yara Bandı": 4, "Temizlik Deposu||Kırtasiye Bandı": 20, "Temizlik Deposu||Çuval Ağzı İpi": 7, "Temizlik Deposu||İmza Defteri": 7, "Temizlik Deposu||Not Defteri (büyük boy)": 6, "Temizlik Deposu||Notluk (küçük boy)": 2, "Temizlik Deposu||Kırtasiye Makası": 6, "Temizlik Deposu||Kırmızı Çizgili Kalem": 40, "Temizlik Deposu||Mavi Çizgili Kalem": 48, "Temizlik Deposu||Siyah Kurşun Kalem": 10, "Temizlik Deposu||Kırmızı Kurşun Kalem": 12, "Temizlik Deposu||Siyah Asetat Kalemi": 3, "Temizlik Deposu||İmza Kalemi": 13, "Temizlik Deposu||İmza Kalemi İçi": 3, "Temizlik Deposu||Siyah M Cam Kalemi (pakette 10 adet)": 3, "Temizlik Deposu||Siyah S Cam Kalemi (pakette 10 adet)": 2, "Temizlik Deposu||Mavi M Cam Kalemi (pakette 10 adet)": 1, "Temizlik Deposu||Mavi S Cam Kalemi (pakette 10 adet)": 2, "Temizlik Deposu||Kırmızı Cam Kalemi (pakette 10 adet)": 2, "Temizlik Deposu||Sarı Fosforlu Kalem": 7, "Temizlik Deposu||Silgi": 4, "Temizlik Deposu||Pritt Yapıştırıcı": 1, "Temizlik Deposu||502 Süper Yapıştırıcı": 1, "Temizlik Deposu||2032 Yuvarlak Pil": 5, "Temizlik Deposu||Maket Bıçağı": 5, "Temizlik Deposu||Maket Bıçağı Ucu (pakette 10 adet)": 3, "Temizlik Deposu||Zımba Teli (15 kağıtlık)": 5, "Temizlik Deposu||Zımba Teli (30 kağıtlık)": 4, "Temizlik Deposu||Sekreter Tırnağı": 5, "Temizlik Deposu||Ataş (4 no 100 adet)": 9, "Temizlik Deposu||Ataş (3 no 100 adet)": 5, "Temizlik Deposu||Zarf": 6, "Temizlik Deposu||Büyük Boy Delgeç": 4, "Temizlik Deposu||Büyük Boy Zımba": 4, "Temizlik Deposu||Küçük Boy Zımba": 4, "Temizlik Deposu||Şeffaf Poşet Dosya": 12, "Temizlik Deposu||Tuvalet Fırçası": 9, "Temizlik Deposu||cif krem temizleyici": 18, "Temizlik Deposu||Asperox Mavi Güç (1 litre)": 18, "Temizlik Deposu||Sıvı Sabun 400 ml": 8, "Temizlik Deposu||arap sabunu": 2, "Temizlik Deposu||ace 4 l çamaşır suyu": 3, "Orta Depo||Siperlik (kolide ortalama 100 adet)": 16, "Orta Depo||Falcon Tüp 15ml (pakette 500 adet)": 20, "Orta Depo||Falcon Tüp 50ml (pakette 500 adet)": 40, "Orta Depo||Falcon Tüp Steril 15ml (bakteri)": 8, "Orta Depo||Falcon Tüp Steril 50ml (bakteri)": 5, "Orta Depo||Falcon Tüp 50ml (bakteri)": 4, "Orta Depo||Kimyasal Maskesi": 17, "Orta Depo||Kimyasal Maske Filtresi ()": 38, "Orta Depo||Çorap Swap": 16, "Orta Depo||Sünger Swap": 7, "Orta Depo||Toz Swap": 3, "Orta Depo||Dökme Pipet Ucu 200ul NEST": 78, "Orta Depo||Mavi Önlük (Arşivden)": 24, "Orta Depo||Mavi Önlük (Arşivden gelenler)": 10, "Orta Depo||Klavye/Mouse set (a4tech)": 4, "Orta Depo||Klavye/Mouse set (RAYNOX)": 3, "Orta Depo||Logitech kamera": 1, "Orta Depo||Toner 204U": 4, "Orta Depo||Toner 201A": 3, "Orta Depo||Toner 12A": 0, "Orta Depo||Toner CB540A": 1, "Orta Depo||Toner CF219A": 0, "Orta Depo||Toner Q2612A": 6, "Orta Depo||Toner CESOSX": 0, "Orta Depo||Toner GREEN yüksek kaliteli": 1, "Orta Depo||Mini Termometre": 1, "Orta Depo||1,5V A76 ufak yuvarlak pil": 8, "Orta Depo||2032 yuvarlak pil": 20, "Orta Depo||oto buzdolabı": 3, "Asansör Yanı||Nekropsi Seti": 1, "Asansör Yanı||U tabanlı mikropleyt": 4, "Asansör Yanı||96'lı pleyt kapağı": 1, "Asansör Yanı||Otoklav Bandı": 10, "Asansör Yanı||Parafilm": 4, "Asansör Yanı||Test Pleyti": 4, "Asansör Yanı||Bistüri Ucu (100 adet/paket)": 20, "Asansör Yanı||Musluklu Bidon": 9, "Asansör Yanı||Filtreli Pipet Ucu NEST 1000ul": 33, "Asansör Yanı||Cam Deney Tüpü": 1, "Asansör Yanı||Cam Şişe 500ml": 18, "Asansör Yanı||Cam Şişe 1000ml": 2, "Asansör Yanı||Cam Şişe 1000ml amber": 1, "Asansör Yanı||Cam Şişe 500ml (kutuda 10)": 1, "Asansör Yanı||Cam Şişe 250ml (kutuda 10)": 3, "Asansör Yanı||Cam Şişe 100ml (kutuda 10)": 1, "Asansör Yanı||Staining Jar (schiefferdecker)": 7, "Asansör Yanı||Staining Jar (hellendahl)": 7, "Asansör Yanı||Measuring Cylinder 1000ml": 1, "Asansör Yanı||Measuring Cylinder 500ml": 2, "Asansör Yanı||Measuring Cylinder 250ml": 1, "Asansör Yanı||Measuring Cylinder 50ml": 1, "Asansör Yanı||Cam Pipet 25ml": 2, "Asansör Yanı||Cam Pipet 5ml": 2, "Asansör Yanı||Cam Pipet 1ml": 2, "Asansör Yanı||Metal Cam Pipet Kutusu": 3, "Asansör Yanı||Vorsicht Glass (Bakteri/Pastör Pipet)": 4, "Asansör Yanı||Cam Kavanoz": 12, "Asansör Yanı||Kavanoz Kapağı": 1, "Asansör Yanı||Mezur 2000ml": 3, "Asansör Yanı||Mezur 1000ml": 2, "Asansör Yanı||Beher 600ml": 1, "Asansör Yanı||Beher 250ml": 1, "Asansör Yanı||Erlen 250ml": 1, "Asansör Yanı||Flask cam malzeme 500ml": 5, "Asansör Yanı||Volumetric Flask 1000ml": 3, "Asansör Yanı||Volumetric Flask 500ml": 2, "Asansör Yanı||Volumetric Flask 100ml": 7, "Asansör Yanı||Kapaklı 1 Litre kap": 1, "Asansör Yanı||Kırmızı Kapaklı Numune Kabı": 1, "Asansör Yanı||ISOLAB tüp 0,5ml": 6, "Asansör Yanı||Rotorgene Q Strip tüp": 1, "Asansör Yanı||1,5ml AXYGEN microtubes": 49, "Asansör Yanı||0,5ml PCR Tubes AXYGEN": 9, "Asansör Yanı||0,2ml PCR Tubes AXYGEN": 20, "Asansör Yanı||0,1ml PCR Strip Tubes AXYGEN": 30, "Asansör Yanı||2ml microtubes AXYGEN": 20, "Asansör Yanı||Petri Kabı (Büyük 9cm)": 16, "Asansör Yanı||Petri Kabı 60'lık": 4, "Asansör Yanı||Plastik Öze": 4, "Asansör Yanı||Plastik Öze (kutuda 1000 adet)": 45, "Asansör Yanı||Holder": 3, "Asansör Yanı||Falcon Tüp 15ml": 2, "Asansör Yanı||Falcon Tüp Steril 50ml": 3, "Asansör Yanı||Klasik Swap (kutuda 2000)": 10, "Asansör Yanı||Pamuklu Swap": 8, "Asansör Yanı||Siyah Pamuklu Swap": 1, "Asansör Yanı||Pipet Ucu NEST 200ul": 9, "Asansör Yanı||Dökme Sarı Pipet Ucu 200ul": 6, "Asansör Yanı||Dökme Pipet Ucu 1000ul": 1, "Asansör Yanı||şırınga 20 ml": 2, "Asansör Yanı||Şırınga 50ml": 4, "Asansör Yanı||Şırınga 10ml": 4, "Asansör Yanı||Şırınga 5ml": 3, "Asansör Yanı||Şırınga 2ml": 19, "Asansör Yanı||Şırınga 1ml": 7, "Asansör Yanı||Kan Alma İğnesi": 30, "Asansör Yanı||Yeşil Eldiven": 3, "Asansör Yanı||Hücre Kültürü Flask 250ml": 1, "Asansör Yanı||Hücre Kültürü Scraper": 1, "Asansör Yanı||Hücre Kültürü Pleyt": 2, "Asansör Yanı||Hücre Kültürü Flask 50ml": 9, "Asansör Yanı||Hücre Kültürü Flask 250ml (paket)": 16, "Asansör Yanı||Hücre Kültürü Test Plate": 14, "Asansör Yanı||Serolojik Pipet ½ml": 6, "Asansör Yanı||Serolojik Pipet 1/10ml": 4, "Asansör Yanı||Serolojik Pipet 1/100ml": 3, "Asansör Yanı||Serolojik Pipet 10ml (KHT)": 4, "Asansör Yanı||Serolojik Pipet 5ml (KHT)": 6, "Asansör Yanı||Eppendorf Pipet ucu 10ul filtreli": 1, "Asansör Yanı||Eppendorf Pipet ucu 20ul filtreli": 2, "Asansör Yanı||Eppendorf Pipet ucu 200ul filtreli": 2, "Asansör Yanı||Filtreli Pipet Ucu NEST 200ul": 25, "Asansör Yanı||Filtreli Pipet Ucu NEST 20ul": 19, "Asansör Yanı||Filtreli Pipet Ucu NEST 10ul": 34, "Asansör Yanı||Filtreli pipet ucu brand 1000 ul": 5, "Asansör Yanı||Filtreli Pipet Ucu BRAND 200ul": 15, "Asansör Yanı||Filtreli Pipet Ucu BRAND 100ul": 20, "Asansör Yanı||Filtreli Pipet Ucu BRAND 20ul": 10, "Asansör Yanı||Filtreli Pipet Ucu Brand 10ul": 15, "Asansör Yanı||Axygen Filtreli Pipet Ucu 100 ul": 5, "Asansör Yanı||markasız 200 ul filtreli pipet ucu": 1, "Asansör Yanı||Dökme Pipet Ucu BRAND 200ul": 2, "Asansör Yanı||Kırmızı Kan Tüpü": 20, "Asansör Yanı||Mor Kan Tüpü": 18, "Asansör Yanı||Sarı Kan Tüpü": 2, "Asansör Yanı||Microtube Rack": 12, "Asansör Yanı||Piset": 18, "Asansör Yanı||Cryogenic Storage Box": 30, "Asansör Yanı||Slide Box (100 slides)": 0, "Asansör Yanı||Slide Box (50 slides)": 9, "Asansör Yanı||Tube Rack 2ml": 50, "Asansör Yanı||Su Arıtma Cihazı Filtresi": 4, "Asansör Yanı||Sample Tubes 2ml": 1, "Asansör Yanı||Hücre Kültürü Flask 25cm2": 2, "Asansör Yanı||Tülbent Bezi": 1, "Asansör Yanı||20 ul Filtreli Pipet ucu KIRGEN (bakteri)": 9, "Asansör Yanı||200 ul Filtreli Pipet ucu KIRGEN (bakteri)": 8, "Asansör Yanı||10 ul Filtreli pipet uvu kırgen (bakteri)": 3, "Asansör Yanı||200 ul Filtreli Pipet ucu nest (bakteri)": 5, "Asansör Yanı||100 ul Filtreli pipet ucu nest bakteri": 8, "Asansör Yanı||20 ul Filtreli Pipet ucu nest (bakteri)": 6, "Asansör Yanı||225 ml buffered peptone water şişesi": 2, "Asansör Yanı||pastör pipeti": 10, "Asansör Yanı||microscope slides": 50, "Asansör Yanı||microscope cover glasses": 2, "Asansör Yanı||160 mm makas": 45, "Asansör Yanı||130 mm makas": 7, "Asansör Yanı||130 mm pens": 2, "Asansör Yanı||150 mm pens": 30, "Asansör Yanı||kan torbası": 5, "Asansör Yanı||plastik soğuk blok": 2, "Asansör Yanı||metal boncuk": 15, "Asansör Yanı||mini termometre": 20, "Kimyasal Deposu||Detrox (fümigasyon cihazı)": 36, "Kimyasal Deposu||Virkon S": 4, "Kimyasal Deposu||Biodes Konsantre Dezenfektan (5l)": 5, "Kimyasal Deposu||Biocan-a Konsantre Toz Dezenfektan (1kg)": 83, "Kimyasal Deposu||El Dezenfektanı (1Litre)": 10, "Kimyasal Deposu||Göz Yıkama Seti": 10, "Kimyasal Deposu||Ksilen 5 Litre": 10, "Kimyasal Deposu||Lugol Solüsyonu %5": 1, "Kimyasal Deposu||Tris (C4H11NO3)": 2, "Kimyasal Deposu||Edta, Free Acid": 1, "Kimyasal Deposu||Boric Acid (H3BO3)": 1, "Kimyasal Deposu||Agarose (jel elektroforez)": 2, "Kimyasal Deposu||Buffer Solution": 3, "Kimyasal Deposu||Methanol (2,5L)": 2, "Kimyasal Deposu||Chloroform": 1, "Kimyasal Deposu||Teksol Sanayi Makine Temizleyici (5l)": 84, "Kimyasal Deposu||Ethanol Absolute %99": 72, "Kimyasal Deposu||Gliserin %99,5 (2,5L)": 0, "Kimyasal Deposu||Acetic Acid (glacial) 2,5L": 0, "Kimyasal Deposu||Dietil Eter 1L": 1, "Kimyasal Deposu||Dietil Eter 2,5L": 1, "Kimyasal Deposu||Ziehl-Neelsen Carbol-Fuchsin": 3, "Kimyasal Deposu||İmmersion Oil (100ml)": 2, "Kimyasal Deposu||Entellan (500ml)": 0, "Kimyasal Deposu||Propanol (500ml)": 2, "Kimyasal Deposu||Aseton": 1, "Kimyasal Deposu||Sellers Boyama": 2, "Kimyasal Deposu||Formaldehyde Solution": 1, "Kimyasal Deposu||Ph4 Buffer Solution HI5004": 1, "Kimyasal Deposu||Ph4 Buffer Solution HI7004": 1, "Kimyasal Deposu||Ph10 Buffer Solution": 1, "Kimyasal Deposu||Ethylenediaminetetraacetic Acid": 1, "Kimyasal Deposu||Sodium Azide": 1, "Kimyasal Deposu||Dimethyl Sulfoxid": 1, "Kimyasal Deposu||Tryptose Phosphate Broth": 1, "Kimyasal Deposu||Glucose": 1, "Kimyasal Deposu||Phenolrot": 1, "Kimyasal Deposu||Sodyum Hidrojen Karbonat": 1, "Kimyasal Deposu||Evans Blue": 1, "Kimyasal Deposu||Trizma Base 900g": 1, "Kimyasal Deposu||Di-Potassium Hydrogen Phosphate 600g": 1, "Kimyasal Deposu||Sodium Hydrogen Carbonate 900g": 1, "Kimyasal Deposu||Sodium Hydroxide 600g": 1, "Kimyasal Deposu||Nitric Acid 2,3 Litre": 1, "Kimyasal Deposu||Formic Acid %98 900ml": 1, "Kimyasal Deposu||Acetic Acid (glacial) 2,2L": 1, "Kimyasal Deposu||Di Sodium Hydrogen Phosphate 400g": 1, "Kimyasal Deposu||Propanol 2,5 litre cam şişe (SUPELCO)": 1, "Kimyasal Deposu||Propanol 2,5 litre for analysis (SUPELCO)": 4, "Kimyasal Deposu||Neo-Mount (500ml)": 1, "Kimyasal Deposu||Tyrosine (100g)": 2, "Kimyasal Deposu||Hydrogen Peroxide %35 2,5L": 1, "Kimyasal Deposu||Saf Su 5 litre": 1, "Kimyasal Deposu||Cell Culture Water (500ml)": 1, "Kimyasal Deposu||Parafin Boncuk 2,5 Kg": 2, "Kimyasal Deposu||Carbol Fuchsin Solution 1000ml": 2, "Kimyasal Deposu||Salicylic Acid 1 Kg": 1, "Kimyasal Deposu||Rose-Bengal Agar 500g": 1, "Kimyasal Deposu||Potassium Chloride 1 kg": 3, "Kimyasal Deposu||Copper(II) Sulfate Pentahydrate": 1, "Kimyasal Deposu||Kaliumiodid 1 kg": 1, "Kimyasal Deposu||Natriumdodecylsulfat 1 kg": 1, "Kimyasal Deposu||Bakır Tuzu": 1, "Kimyasal Deposu||Silica": 1, "Kimyasal Deposu||Iron(III) Chloride Hexahydrate": 1, "Kimyasal Deposu||Essigsaure 2,5 Litre": 0, "Kimyasal Deposu||Propanol 2,5 litre (ISOLAB)": 1, "Kuş Gribi Deposu||Veteriner Çantası": 37, "Kuş Gribi Deposu||Metal Malzeme Kutusu": 17, "Kuş Gribi Deposu||Şeffaf Tüp Saklama Kutusu": 61, "Kuş Gribi Deposu||Holder": 5, "Kuş Gribi Deposu||swap": 36, "Kuş Gribi Deposu||Eppendorf Tüp (fıratmed)": 20};

function initStok() {
  // Henüz stok[key] tanımlı değilse Excel sayımından yükle
  for (const [key, mevcut] of Object.entries(STOK_INIT)) {
    if (!stok[key]) {
      stok[key] = { mevcut, min: 0, max: 0 };
    }
  }
}

// ── SKT Başlangıç Verileri (Kimyasal Deposu) ──────────────────
const SKT_INIT = {"Detrox (fümigasyon cihazı)": "2026-04-15", "Virkon S": "2023-08-21", "Biodes Konsantre Dezenfektan (5l)": "2013-03-09", "Biocan-a Konsantre Toz Dezenfektan (1kg)": "2013-02-09", "El Dezenfektanı (1Litre)": "2027-09-24", "Göz Yıkama Seti": "2028-04-01", "Ksilen 5 Litre": "2028-08-12", "Lugol Solüsyonu %5": "2027-08-30", "Agarose (jel elektroforez)": "2027-08-09", "Buffer Solution": "2023-06-30", "Methanol (2,5L)": "2028-05-31", "Teksol Sanayi Makine Temizleyici (5l)": "2027-10-01", "Ethanol Absolute %99": "2027-10-01", "Dietil Eter 1L": "2027-11-17", "Dietil Eter 2,5L": "2027-11-17", "Ziehl-Neelsen Carbol-Fuchsin": "2027-09-30", "İmmersion Oil (100ml)": "2027-07-31", "Sellers Boyama": "2003-05-05", "Ph4 Buffer Solution HI5004": "2022-04-01", "Ph4 Buffer Solution HI7004": "2017-12-01", "Ph10 Buffer Solution": "2019-09-01", "Tryptose Phosphate Broth": "2006-03-01", "Glucose": "2006-01-31", "Di-Potassium Hydrogen Phosphate 600g": "2015-06-30", "Sodium Hydrogen Carbonate 900g": "2019-02-28", "Nitric Acid 2,3 Litre": "2014-04-30", "Formic Acid %98 900ml": "2021-09-30", "Di Sodium Hydrogen Phosphate 400g": "2019-04-30", "Propanol 2,5 litre cam şişe (SUPELCO)": "2024-08-31", "Propanol 2,5 litre for analysis (SUPELCO)": "2025-09-30", "Neo-Mount (500ml)": "2025-07-31", "Tyrosine (100g)": "2023-01-01", "Hydrogen Peroxide %35 2,5L": "2025-08-01", "Saf Su 5 litre": "2028-07-31", "Cell Culture Water (500ml)": "2025-11-28", "Parafin Boncuk 2,5 Kg": "2025-11-09", "Carbol Fuchsin Solution 1000ml": "2022-10-01", "Rose-Bengal Agar 500g": "2025-10-31", "Potassium Chloride 1 kg": "2025-09-01", "Copper(II) Sulfate Pentahydrate": "2026-03-01", "Kaliumiodid 1 kg": "2022-07-12", "Natriumdodecylsulfat 1 kg": "2025-10-01", "Bakır Tuzu": "2023-04-08", "Silica": "2025-10-16", "Iron(III) Chloride Hexahydrate": "2027-01-01", "Propanol 2,5 litre (ISOLAB)": "2025-08-01"};

function initSKT() {
  for (const [ad, skt] of Object.entries(SKT_INIT)) {
    const k = getKey('Kimyasal Deposu', ad);
    if (!malzemeMeta[k]) malzemeMeta[k] = {};
    if (!malzemeMeta[k].skt) malzemeMeta[k].skt = skt;  // zaten set edilmişse dokunma
  }
}

function sktDurum(sktStr) {
  if (!sktStr) return null;
  const today = new Date();
  today.setHours(0,0,0,0);
  const skt   = new Date(sktStr);
  const diff  = Math.round((skt - today) / 86400000);
  if (diff < 0)   return { cls:'skt-gecmis', label: 'SKT GEÇTİ',      days: diff, icon:'☠' };
  if (diff <= ayarlar.sktKritikGun) return { cls:'skt-kritik', label: diff+'g kaldı',   days: diff, icon:'⚠' };
  if (diff <= ayarlar.sktUyariGun)  return { cls:'skt-uyari',  label: sktStr.slice(0,7), days: diff, icon:'⏱' };
  return               { cls:'skt-ok',     label: sktStr.slice(0,7),  days: diff, icon:'✓' };
}

function sktBadge(sktStr) {
  if (!sktStr) return '';
  const d = sktDurum(sktStr);
  if (!d) return '';
  return '<span class="skt-badge '+d.cls+'" title="Son Kullanma: '+sktStr+'">'+d.icon+' '+d.label+'</span>';
}

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  const ov=document.getElementById('sidebar-overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('open');
}

// ── Zaman göstergesi (ne kadar önce) ──────────────────────────────
function timeAgo(date) {
  const sec = Math.round((new Date() - date) / 1000);
  if (sec < 60)  return 'az önce';
  const min = Math.round(sec / 60);
  if (min < 60)  return min + ' dk önce';
  const hr  = Math.round(min / 60);
  if (hr  < 24)  return hr  + ' sa önce';
  const day = Math.round(hr  / 24);
  if (day < 7)   return day + ' gün önce';
  return date.toLocaleDateString('tr-TR');
}

// ── Canlı saat ────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const cl = document.getElementById('topbar-clock');
  if (cl) cl.textContent = now.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
document.getElementById('topbar-date').textContent =
  new Date().toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
updateClock();
setInterval(updateClock, 1000);

// ── Sütun menüsü + hareket mal dropdown dışına tıklanınca kapat ──
document.addEventListener('click', e => {
  const menu = document.getElementById('stok-sutun-menu');
  const btn  = document.getElementById('stok-sutun-btn');
  if (menu && !menu.contains(e.target) && !btn?.contains(e.target)) {
    menu.classList.remove('open');
  }
  const dd   = document.getElementById('h-mal-dropdown');
  const wrap = document.getElementById('h-mal-wrap') || dd?.closest('.h-mal-wrap');
  if (dd && wrap && !wrap.contains(e.target)) {
    dd.classList.remove('open');
  }
});

// ── Klavye kısayolları ────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  const tag = document.activeElement?.tagName;
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // ESC: aktif arama kutusunu temizle
  if (e.key === 'Escape') {
    const searches = [
      { id: 'stok-search',  fn: () => renderStok() },
      { id: 'har-search',   fn: () => { harSayfa=0; renderHareketList(); } },
      { id: 'ekle-search',  fn: () => renderMalzemeEkleList() },
    ];
    searches.forEach(({ id, fn }) => {
      const el = document.getElementById(id);
      if (el && document.activeElement === el && el.value) {
        el.value = '';
        const clr = document.getElementById(id + '-clear');
        if (clr) clr.style.display = 'none';
        fn();
      }
    });
  }

  // Alt+1–6: sayfa navigasyonu
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const navMap = { '1':'dashboard','2':'stok','3':'hareket','4':'istatistik','5':'kritik','6':'talep' };
    if (navMap[e.key]) { e.preventDefault(); navigate(navMap[e.key]); return; }
  }

  // /: aktif sayfanın arama kutusuna odaklan
  if (e.key === '/' && !inInput) {
    const searchMap = { stok:'stok-search', hareket:'har-search', 'malzeme-ekle':'ekle-search' };
    const id = searchMap[aktifSayfa];
    if (id) { e.preventDefault(); document.getElementById(id)?.focus(); }
  }
});


// API bağlantısı varsa sunucudan yükle, yoksa boş başla
(async () => {
  const alive = await apiPing();
  if (alive) {
    await apiLoad();
  } else {
    console.warn('PHP API bulunamadı — yerel modda çalışıyor (veri kaybolabilir)');
    toast('⚠ Sunucu bağlantısı yok — veriler kaydedilmeyecek', 'error');
  }
  ayarlariYukle();      // localStorage'dan ayarları yükle + tema uygula
  talepListesiYukle(); // Talep listesini localStorage'dan yükle
  initStok();           // Excel sayımı — sunucu verisi yoksa devreye girer
  initSKT();            // SKT başlangıç verileri
  initBirimSelects();   // Birim dropdown'larını doldur
  initKatSelects();     // Kategori dropdown'larını doldur
  initDepoSelects();    // Depo dropdown'larını doldur
  renderDashboard();
})();