import { S, KAYNAK, DEPO_META, DEPO_BADGE } from './state.js';

// ═══════════════════════════════════════════════════════════════════
// YARDIMCI FONKSİYONLAR
// ═══════════════════════════════════════════════════════════════════

export function getKey(depo, mal) { return depo + '||' + mal; }

// XSS koruması: HTML metin bağlamı için
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// HTML attribute içinde JS string + attribute escape (sadece <option
// value="${escQ(...)}"> gibi nadir kullanım için kalır; inline onclick
// pattern'i artık yok — data-action + JSON args ile temin ediliyor).
export function escQ(s) { return String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r?\n/g,'\\n'); }

// FIX: Varsayılan min=0, max=0 → stok girilmeden hiçbir şey kritik değil
export function getStok(depo, mal) {
  const k = getKey(depo, mal);
  if (!S.stok[k]) S.stok[k] = {mevcut: 0, min: 0, max: 0};
  return S.stok[k];
}

// Tüm malzemeleri (kaynak + özel, silinmişler hariç) döndürür
export function getAllItems() {
  const result = [];
  for (const [dep, items] of Object.entries(KAYNAK)) {
    for (const item of items) {
      const k = getKey(dep, item.ad);
      if (S.silinmis[k]) continue;
      const _mk=getKey(dep,item.ad);const _mm=S.malzemeMeta[_mk]||{};
      result.push({depo:dep,ad:item.ad,sayim:item.sayim,ozel:false,birim:_mm.birim||'',kategori:_mm.kategori||''});
    }
  }
  for (const [k, item] of Object.entries(S.ozelMalzeme)) {
    if (S.silinmis[k]) continue;  // özel malzeme de silinebilir
    const _omm=S.malzemeMeta[k]||{};
    result.push({depo:item.depo,ad:item.ad,sayim:item.sayim,ozel:true,birim:item.birim||_omm.birim||'',kategori:item.kategori||_omm.kategori||''});
  }
  return result;
}

export function getDepoItems(dep) {
  return getAllItems().filter(i => i.depo === dep);
}

export function durum(mevcut, min, max) {
  if (mevcut === 0) return 'Kritik';           // stok sıfır → her zaman kritik
  if (min === 0 && max === 0) return 'Normal'; // stok tanımlanmamış → nötr
  if (mevcut <= min) return 'Kritik';
  if (max > 0 && mevcut >= max) return 'Fazla';
  return 'Normal';
}

export function durumBadge(d) {
  const map  = {Kritik:'badge-kritik', Normal:'badge-normal', Fazla:'badge-fazla'};
  const icon = {Kritik:'alert-triangle', Normal:'check', Fazla:'trending-up'};
  return `<span class="badge ${map[d]}"><i data-lucide="${icon[d]}" class="icon-inline"></i> ${d}</span>`;
}

export function depoBadge(dep) {
  const m = DEPO_META[dep];
  if (!m) return `<span class="badge">${esc(dep)}</span>`;
  if (DEPO_BADGE[dep]) return `<span class="badge ${DEPO_BADGE[dep]}">${esc(m.kod)}</span>`;
  return `<span class="badge" style="background:${m.color}22;color:${m.color}">${esc(m.kod)}</span>`;
}

export function fmtGun(d) {
  if (!(d instanceof Date)) d = new Date(d);
  if (S.ayarlar.tarihFormat === 'iso') {
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  return d.toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'});
}
export function fmt(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return fmtGun(d) + ' ' + d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
}

export function toast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) return;
  const ico = {success:'check-circle', info:'info', error:'x-circle'}[type] || 'check-circle';
  t.innerHTML = `<i data-lucide="${ico}" class="icon-inline"></i> <span>${esc(msg)}</span>`;
  t.className = 'show ' + type;
  if (window.lucide) lucide.createIcons({ nodes: [t] });
  setTimeout(()=> t.className='', 2800);
}

// Notification API yalnızca güvenli context'lerde (HTTPS + localhost)
// kullanılabilir; HTTP origin'de izin istemi kabul edilmez. window.
// isSecureContext browser-native bayrağı bu durumu özetler.
export function notificationDestekleniyor() {
  return 'Notification' in window && window.isSecureContext;
}
export function notificationDurumu() {
  if (!('Notification' in window))  return 'unsupported';
  if (!window.isSecureContext)      return 'insecure';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export function checkKritikNotification() {
  if (!S.ayarlar.bildirimAktif) return;
  if (!notificationDestekleniyor() || Notification.permission !== 'granted') return;
  const now = Date.now();
  if (now - S._sonBildirimZamani < 5 * 60 * 1000) return; // en fazla 5 dakikada bir
  const kritikler = getAllItems().filter(i => durum(getStok(i.depo, i.ad).mevcut, getStok(i.depo, i.ad).min, getStok(i.depo, i.ad).max) === 'Kritik');
  if (kritikler.length === 0) return;
  S._sonBildirimZamani = now;
  new Notification('Kritik Stok Uyarısı — ' + (S.ayarlar.kurumAdi || 'DYS'), {
    body: `${kritikler.length} malzeme kritik: ${kritikler.slice(0, 3).map(i => i.ad).join(', ')}${kritikler.length > 3 ? '…' : ''}`,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="24" font-size="24">⚠️</text></svg>'
  });
}

export async function bildirimIzniSor() {
  if (!('Notification' in window)) { toast('Tarayıcınız bildirimleri desteklemiyor.', 'error'); return; }
  if (!window.isSecureContext) {
    toast('Bildirimler yalnızca HTTPS bağlantısında çalışır. Sunucu HTTPS kurulduğunda aktifleşir.', 'error');
    return;
  }
  if (S.ayarlar.bildirimAktif) { window.setAyar('bildirimAktif', false); toast('Bildirimler kapatıldı.'); window.renderAyarlar(); return; }
  if (Notification.permission === 'denied') { toast('Bildirimler tarayıcı tarafından engellendi. Tarayıcı ayarlarından izin verin.', 'error'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') { window.setAyar('bildirimAktif', true); toast('Bildirimler aktif ✓'); }
  else { window.setAyar('bildirimAktif', false); toast('Bildirim izni verilmedi.', 'error'); }
  window.renderAyarlar();
}

// ── Zaman göstergesi (ne kadar önce) ──────────────────────────────
export function timeAgo(date) {
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
export function updateClock() {
  const now = new Date();
  const cl = document.getElementById('topbar-clock');
  if (cl) cl.textContent = now.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

// ── data-* delegation helpers ─────────────────────────────────────
// Inline onclick/onchange/oninput/onkeydown yerine HTML template'lerde
// kullanılır. main.js'teki delegation dispatcher'ları bunları okur.
function _jsonAttr(args) {
  // JSON'u çift-tırnaklı HTML attribute içine güvenle yerleştir
  return JSON.stringify(args).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
export function dClick(name, ...args) {
  if (!args.length) return `data-action="${name}"`;
  return `data-action="${name}" data-args="${_jsonAttr(args)}"`;
}
export function dChange(name, ...args) {
  if (!args.length) return `data-change="${name}"`;
  return `data-change="${name}" data-args="${_jsonAttr(args)}"`;
}
export function dInput(name, ...args) {
  if (!args.length) return `data-input="${name}"`;
  return `data-input="${name}" data-args="${_jsonAttr(args)}"`;
}
// key opsiyonel filtre (örn. 'Enter'); null → tüm tuşlar
export function dKeydown(name, key, ...args) {
  const keyAttr = key ? ` data-key="${key}"` : '';
  if (!args.length) return `data-keydown="${name}"${keyAttr}`;
  return `data-keydown="${name}"${keyAttr} data-args="${_jsonAttr(args)}"`;
}

// Expose on window for inline handlers
window.toast = toast;
window.esc = esc;
window.durumBadge = durumBadge;
window.depoBadge = depoBadge;
window.bildirimIzniSor = bildirimIzniSor;
