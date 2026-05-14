import { S, API_URL } from './state.js';

// ═══════════════════════════════════════════════════════════════════
// PHP API KATMANI — QNAP Web Server
// ═══════════════════════════════════════════════════════════════════

export function getToken() {
  let t = localStorage.getItem('depoToken');
  if (!t) {
    t = (window.prompt('Sunucu erişim tokenini girin:') || '').trim();
    if (t) localStorage.setItem('depoToken', t);
  }
  return t;
}

export async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}), Authorization: 'Bearer ' + token };
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401) {
    localStorage.removeItem('depoToken');
    window.toast('Geçersiz token — sayfayı yenileyin', 'error');
    throw new Error('401 Unauthorized');
  }
  return r;
}

// API erişilebilir mi? (sayfa yüklenince test et)
export async function apiPing() {
  try {
    const r = await apiFetch(API_URL + '?action=load', {signal: AbortSignal.timeout(3000)});
    if (r.ok) { S.API_MOD = true; return true; }
  } catch(e) {}
  return false;
}

// Sunucudan veri yükle
export async function apiLoad() {
  try {
    const r    = await apiFetch(API_URL + '?action=load');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const json = await r.json();
    if (!json.ok) { console.error('API load:', json.error); return false; }
    const d = json.data;
    S.stok        = d.stok        || {};
    S.hareketler  = d.hareketler  || [];
    S.ozelMalzeme = d.ozelMalzeme || {};
    S.silinmis    = d.silinmis    || {};
    S.malzemeMeta = d.malzemeMeta || {};
    S._serverVersion = json.version || 0;
    if (json.yeni) window.toast('İlk çalıştırma — boş veri oluşturuldu.', 'info');
    else window.toast('Veriler sunucudan yüklendi ✓');
    return true;
  } catch(e) {
    window.toast('Sunucuya bağlanılamadı: ' + e.message, 'error');
    return false;
  }
}

// Sunucuya veri kaydet (debounce: 800ms)
export function apiSave() {
  if (!S.API_MOD) return;
  clearTimeout(S._saveTimer);
  S._saveTimer = setTimeout(async () => {
    try {
      const payload = { stok: S.stok, hareketler: S.hareketler, ozelMalzeme: S.ozelMalzeme, silinmis: S.silinmis, malzemeMeta: S.malzemeMeta, _version: S._serverVersion };
      const r    = await apiFetch(API_URL + '?action=save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      if (r.status === 409) {
        window.toast('Veriler başka yerden değişti, yeniden yükleniyor…', 'error');
        setTimeout(() => location.reload(), 1500);
        return;
      }
      const json = await r.json();
      if (!json.ok) { window.toast('Kayıt hatası: ' + json.error, 'error'); return; }
      if (json.version != null) S._serverVersion = json.version;
      // Sessiz kayıt — başarılı bildirimi gösterme
      const _as = document.getElementById('api-status'); if(_as) _as.textContent = '💾 ' + new Date().toLocaleTimeString('tr-TR');
    } catch(e) {
      window.toast('Sunucu bağlantı hatası: ' + e.message, 'error');
    }
  }, 800);
}

// Yedek listesini çek
export async function apiBackupList() {
  try {
    const r    = await apiFetch(API_URL + '?action=backup_list');
    const json = await r.json();
    if (!json.ok) return [];
    return json.yedekler || [];
  } catch(e) { return []; }
}

// Yedek oluştur
export async function apiBackupOlustur() {
  if (!S.API_MOD) { window.toast('Sunucu bağlantısı yok', 'error'); return; }
  try {
    const r    = await apiFetch(API_URL + '?action=backup_olustur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const json = await r.json();
    if (json.ok) { window.toast(`Yedek alındı: ${json.dosya} ✓`); window.refreshAll(); }
    else window.toast('Yedekleme hatası: ' + json.error, 'error');
  } catch(e) { window.toast('Sunucu hatası', 'error'); }
}

// Belirli yedeği yükle
export async function apiBackupLoad(dosya) {
  if (!confirm(`"${dosya}" yedeği yüklenecek. Mevcut veriler silinecek. Devam edilsin mi?`)) return;
  try {
    const r    = await apiFetch(API_URL + '?action=backup_yukle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dosya })
    });
    const json = await r.json();
    if (!json.ok) { window.toast('Yedek yüklenemedi: ' + json.error, 'error'); return; }
    // Sayfayı yenile (en güvenli yol — state server'dan reload)
    window.toast('Yedek yüklendi — sayfa yenileniyor...');
    setTimeout(() => location.reload(), 1200);
  } catch(e) { window.toast('Yedek yüklenemedi', 'error'); }
}

// Sıfırla (sunucuda da sıfırla)
export async function apiReset() {
  if (!S.API_MOD) return;
  try {
    await apiFetch(API_URL + '?action=reset', {method:'POST'});
  } catch(e) {
    console.warn('apiReset:', e);
    window.toast('Sunucuda sıfırlama başarısız: ' + e.message, 'error');
  }
}
