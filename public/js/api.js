import { S, API_URL } from './state.js';

// ═══════════════════════════════════════════════════════════════════
// API KATMANI — Node/Express backend
// ═══════════════════════════════════════════════════════════════════

export function getToken() {
  return localStorage.getItem('depoToken') || '';
}

// Login modal'ı göster — Promise döndürür, user submit ettiğinde resolve olur.
// İlk çağrıda init eder, sonraki çağrılarda mevcut promise'ı reuse eder.
let _loginPromise = null;
export function showLogin(hata = '') {
  if (_loginPromise) return _loginPromise;
  _loginPromise = new Promise(resolve => {
    const modal = document.getElementById('modal-login');
    const form  = document.getElementById('login-form');
    const input = document.getElementById('login-token');
    const errEl = document.getElementById('login-err');
    if (!modal || !form || !input) {
      // Modal yoksa eski davranışa düş
      const t = (window.prompt('Sunucu erişim tokenini girin:') || '').trim();
      if (t) localStorage.setItem('depoToken', t);
      _loginPromise = null;
      return resolve(t);
    }
    if (hata) { errEl.textContent = hata; errEl.style.display = 'block'; }
    else      { errEl.style.display = 'none'; }
    modal.classList.add('open');
    setTimeout(() => input.focus(), 50);
    const onSubmit = e => {
      e.preventDefault();
      const t = input.value.trim();
      if (!t) return;
      localStorage.setItem('depoToken', t);
      modal.classList.remove('open');
      form.removeEventListener('submit', onSubmit);
      input.value = '';
      _loginPromise = null;
      resolve(t);
    };
    form.addEventListener('submit', onSubmit);
  });
  return _loginPromise;
}

export async function ensureToken() {
  return getToken() || await showLogin();
}

export async function apiFetch(url, options = {}, _retry = true) {
  const token = await ensureToken();
  const headers = { ...(options.headers || {}), Authorization: 'Bearer ' + token };
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401) {
    localStorage.removeItem('depoToken');
    if (_retry) {
      // Token geçersiz — modal'ı tekrar göster ve isteği bir kez retry et
      await showLogin('Geçersiz token, tekrar deneyin');
      return apiFetch(url, options, false);
    }
    window.toast('Geçersiz token', 'error');
    throw new Error('401 Unauthorized');
  }
  return r;
}

// API erişilebilir mi? (sayfa yüklenince test et).
// Token modal'da kullanıcı bekleyebileceği için timeout'u modal sonrası başlat.
export async function apiPing() {
  try {
    await ensureToken();
    const r = await apiFetch(API_URL + '?action=load', { signal: AbortSignal.timeout(3000) });
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

// Payload üreten yardımcı — debounce'lu ve sync flush ortak kullansın
function buildSavePayload() {
  return {
    stok: S.stok,
    ozelMalzeme: S.ozelMalzeme,
    silinmis: S.silinmis,
    malzemeMeta: S.malzemeMeta,
    _version: S._serverVersion,
  };
}

// Asıl POST — debounce'tan ve flush'tan çağrılır
async function _doSave() {
  S._savePending = false;
  try {
    const r = await apiFetch(API_URL + '?action=save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(buildSavePayload())
    });
    if (r.status === 409) {
      window.toast('Veriler başka yerden değişti, yeniden yükleniyor…', 'error');
      setTimeout(() => location.reload(), 1500);
      return;
    }
    const json = await r.json();
    if (!json.ok) { window.toast('Kayıt hatası: ' + json.error, 'error'); return; }
    if (json.version != null) S._serverVersion = json.version;
    const _as = document.getElementById('api-status'); if(_as) _as.textContent = '💾 ' + new Date().toLocaleTimeString('tr-TR');
  } catch(e) {
    window.toast('Sunucu bağlantı hatası: ' + e.message, 'error');
  }
}

// Sunucuya veri kaydet (debounce: 800ms) — hareketler artık ayrı tabloda
export function apiSave() {
  if (!S.API_MOD) return;
  S._savePending = true;
  clearTimeout(S._saveTimer);
  S._saveTimer = setTimeout(_doSave, 800);
}

// Bekleyen debounce'lu save'i hemen yolla ve sonucunu bekle.
// Talep onayı gibi server'da AppState modifikasyonu öncesi gereklidir:
// server-side stok eksiltmesinin doğru baseline'a karşı yapılması için
// local state önce sunucuya flush edilmeli.
export async function apiSaveSync() {
  if (!S.API_MOD) return;
  clearTimeout(S._saveTimer);
  await _doSave();
}

// Sekme kapanırken / gizlenirken pending save'i hemen yolla.
// fetch(..., { keepalive: true }) tarayıcının unload'dan sonra da
// isteği tamamlamasını garanti eder (10MB sınırı var; bizim payload
// genelde <100KB).
export function apiSaveFlush() {
  if (!S.API_MOD || !S._savePending) return;
  clearTimeout(S._saveTimer);
  S._savePending = false;
  const token = localStorage.getItem('depoToken') || '';
  try {
    fetch(API_URL + '?action=save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(buildSavePayload()),
      keepalive: true,
    });
  } catch (_) { /* unload sırasında sessiz kal */ }
}

// ── Hareket API ─────────────────────────────────────────────────────────────

// Yeni hareket ekle — sunucu integer id döner
export async function apiHareketEkle(h) {
  const r = await apiFetch(API_URL + '?action=hareket_ekle', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(h),
  });
  const json = await r.json();
  if (!json.ok) throw new Error(json.error || 'Hareket eklenemedi');
  return json.id;
}

// Hareket sil (integer id)
export async function apiHareketSil(id) {
  const r = await apiFetch(API_URL + '?action=hareket_sil', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ id }),
  });
  const json = await r.json();
  if (!json.ok) throw new Error(json.error || 'Hareket silinemedi');
}

// Hareket listesi çek (sayfalı + filtreli)
export async function apiHareketList(params = {}) {
  const qs = new URLSearchParams({
    action   : 'hareket_list',
    offset   : params.offset   ?? 0,
    limit    : params.limit    ?? 50,
    depo     : params.depo     ?? '',
    malzeme  : params.malzeme  ?? '',
    tur      : params.tur      ?? '',
    tarih_min: params.tarih_min ?? '',
    tarih_max: params.tarih_max ?? '',
    personel : params.personel ?? '',
    q        : params.q        ?? '',
  });
  const r = await apiFetch(API_URL + '?' + qs);
  const json = await r.json();
  if (!json.ok) throw new Error(json.error || 'Liste alınamadı');
  return json; // { hareketler, toplam, ozet }
}

// ── Backup / diğer ──────────────────────────────────────────────────────────

export async function apiBackupList() {
  try {
    const r    = await apiFetch(API_URL + '?action=backup_list');
    const json = await r.json();
    if (!json.ok) return [];
    return json.yedekler || [];
  } catch(e) { return []; }
}

export async function apiBackupOlustur() {
  if (!S.API_MOD) { window.toast('Sunucu bağlantısı yok', 'error'); return; }
  try {
    const r    = await apiFetch(API_URL + '?action=backup_olustur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const json = await r.json();
    if (json.ok) { window.toast(`Yedek alındı: ${json.dosya} ✓`); window.refreshAll(); }
    else window.toast('Yedekleme hatası: ' + json.error, 'error');
  } catch(e) { window.toast('Sunucu hatası', 'error'); }
}

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
    window.toast('Yedek yüklendi — sayfa yenileniyor...');
    setTimeout(() => location.reload(), 1200);
  } catch(e) { window.toast('Yedek yüklenemedi', 'error'); }
}

export async function apiReset() {
  if (!S.API_MOD) return;
  try {
    await apiFetch(API_URL + '?action=reset', {method:'POST'});
  } catch(e) {
    console.warn('apiReset:', e);
    window.toast('Sunucuda sıfırlama başarısız: ' + e.message, 'error');
  }
}
