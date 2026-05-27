import { S, AYARLAR_DEFAULT, DEPO_META, DEPO_BADGE, KAT_COLORS, PAGE_TITLES, STOK_INIT, SKT_INIT, API_URL } from './state.js';
import { esc, escQ, getKey, updateClock, checkKritikNotification } from './ui-common.js';
import { apiPing, apiLoad, apiSave, apiBackupOlustur, apiReset } from './api.js';
import { renderDashboard } from './dashboard.js';
import { renderStok, katBadgeHTML } from './stok.js';
import { renderHareketList } from './hareket.js';
import { renderIstatistik } from './istatistik.js';
import { renderKritik, goDetay } from './kritik.js';
import { renderMalzemeEkleList } from './malzeme.js';
import { renderBackupList, refreshVeriYonet } from './veri.js';
import { initTalep, renderTalepListesi, talepListesiYukle } from './talep.js';
import { ayarlariYukle, ayarlariKaydet, applyTheme, renderAyarlar } from './ayarlar.js';

// ═══════════════════════════════════════════════════════════════════
// GLOBAL HELPERS
// ═══════════════════════════════════════════════════════════════════

export function handleDiger(sel, digerId) {
  const wrap = document.getElementById(digerId + '-wrap');
  if (wrap) wrap.style.display = sel.value === 'Diğer' ? 'block' : 'none';
  if (sel.value !== 'Diğer') {
    const inp = document.getElementById(digerId);
    if (inp) inp.value = '';
  }
}

export function getDigerVal(selId, digerId) {
  const sel = document.getElementById(selId);
  if (!sel) return '';
  if (sel.value === 'Diğer') {
    return (document.getElementById(digerId)?.value || '').trim();
  }
  return sel.value;
}

export function sktDurum(sktStr) {
  if (!sktStr) return null;
  const today = new Date();
  today.setHours(0,0,0,0);
  const skt   = new Date(sktStr);
  const diff  = Math.round((skt - today) / 86400000);
  if (diff < 0)   return { cls:'skt-gecmis', label: 'SKT GEÇTİ',      days: diff, icon:'☠' };
  if (diff <= S.ayarlar.sktKritikGun) return { cls:'skt-kritik', label: diff+'g kaldı',   days: diff, icon:'⚠' };
  if (diff <= S.ayarlar.sktUyariGun)  return { cls:'skt-uyari',  label: sktStr.slice(0,7), days: diff, icon:'⏱' };
  return               { cls:'skt-ok',     label: sktStr.slice(0,7),  days: diff, icon:'✓' };
}

export function sktBadge(sktStr) {
  if (!sktStr) return '';
  const d = sktDurum(sktStr);
  if (!d) return '';
  return '<span class="skt-badge '+d.cls+'" title="Son Kullanma: '+sktStr+'">'+d.icon+' '+d.label+'</span>';
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

export function toggleSidebar() {
  const sb=document.getElementById('sidebar');
  const ov=document.getElementById('sidebar-overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('open');
}

export function refreshAll() {
  apiSave();
  if (S.aktifSayfa === 'dashboard')    renderDashboard();
  if (S.aktifSayfa === 'stok')         renderStok();
  if (S.aktifSayfa === 'kritik')       renderKritik();
  if (S.aktifSayfa === 'istatistik')   renderIstatistik();
  if (S.aktifSayfa === 'hareket')      renderHareketList();
  if (S.aktifSayfa === 'malzeme-ekle') renderMalzemeEkleList();
  if (S.aktifSayfa === 'veri-yonet')   refreshVeriYonet();
  if (S.aktifSayfa === 'depo-detay')   { const d=document.getElementById('detay-content'); if(d&&window._aktifDetayDep) goDetay(window._aktifDetayDep); }
  checkKritikNotification();
}

export function navigate(page) {
  S.aktifSayfa = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const ni = document.querySelector(`.nav-item[onclick*="'${page}'"]`);
  if (ni) ni.classList.add('active');

  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb && sb.classList.contains('open')) { sb.classList.remove('open'); ov?.classList.remove('open'); }

  if (page === 'dashboard')    renderDashboard();
  if (page === 'stok')         renderStok();
  if (page === 'hareket')      renderHareketList();
  if (page === 'istatistik')   renderIstatistik();
  if (page === 'kritik')       renderKritik();
  if (page === 'talep')        initTalep();
  if (page === 'talep-listesi') renderTalepListesi();
  if (page === 'malzeme-ekle') {
    renderMalzemeEkleList();
    const _nd = document.getElementById('yeni-depo');
    const _nm = document.getElementById('yeni-min');
    const _nx = document.getElementById('yeni-max');
    if (_nd && S.ayarlar.varsayilanDepo) _nd.value = S.ayarlar.varsayilanDepo;
    if (_nm) _nm.value = S.ayarlar.varsayilanMinStok ?? 1;
    if (_nx) _nx.value = S.ayarlar.varsayilanMaxStok ?? 10;
  }
  if (page === 'ayarlar')       renderAyarlar();
  if (page === 'veri-yonet') {
    refreshVeriYonet();
    const dk = document.getElementById('api-durum-kart');
    const dt = document.getElementById('api-durum-text');
    const ds = document.getElementById('api-durum-sub');
    const di = document.getElementById('api-durum-icon');
    if (dk) dk.style.display='block';
    if (S.API_MOD) {
      if(di) di.textContent='🟢';
      if(dt) dt.textContent='Sunucu bağlı — veriler otomatik kaydediliyor';
      if(ds) ds.textContent=API_URL;
    } else {
      if(di) di.textContent='🔴';
      if(dt) dt.textContent='Sunucu bağlantısı yok — veriler yalnızca bu oturumda mevcut';
      if(ds) ds.textContent='Sunucu erişilemiyor';
    }
    renderBackupList();
  }
}

export function initKatSelects() {
  const kats = Object.keys(KAT_COLORS);
  const filterSel = document.getElementById('stok-kat-select');
  if (filterSel) filterSel.innerHTML = '<option value="Tümü">Tümü</option>'
    + kats.map(k => `<option value="${k}">${k}</option>`).join('');
  const inputSel = document.getElementById('yeni-kategori');
  if (inputSel) inputSel.innerHTML = '<option value="">— Seçin —</option>'
    + kats.map(k => `<option value="${k}">${k}</option>`).join('');
}

export function initDepoSelects() {
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
  const wrap = document.getElementById('stok-depo-chips');
  if (wrap) {
    const aktifDepo = S.stokDepoFilter || 'Tümü';
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

export function initBirimSelects() {
  const opts = [...S.ayarlar.birimler,'Diğer'].map(b=>`<option value="${b}">${b}</option>`).join('');
  const sel = document.getElementById('yeni-birim');
  if (sel) sel.innerHTML = '<option value="">— Seçin —</option>' + opts;
}

function initStok() {
  for (const [key, mevcut] of Object.entries(STOK_INIT)) {
    if (!S.stok[key]) {
      S.stok[key] = { mevcut, min: 0, max: 0 };
    }
  }
}

function initSKT() {
  for (const [ad, skt] of Object.entries(SKT_INIT)) {
    const k = getKey('Kimyasal Deposu', ad);
    if (!S.malzemeMeta[k]) S.malzemeMeta[k] = {};
    if (!S.malzemeMeta[k].skt) S.malzemeMeta[k].skt = skt;
  }
}

// ── Clock ────────────────────────────────────────────────────────
document.getElementById('topbar-date').textContent =
  new Date().toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
updateClock();
setInterval(updateClock, 1000);

// ── Global click handler ─────────────────────────────────────────
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

// ── Keyboard shortcuts ───────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  const tag = document.activeElement?.tagName;
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (e.key === 'Escape') {
    const searches = [
      { id: 'stok-search',  fn: () => renderStok() },
      { id: 'har-search',   fn: () => { S.harSayfa=0; renderHareketList(); } },
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

  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const navMap = { '1':'dashboard','2':'stok','3':'hareket','4':'istatistik','5':'kritik','6':'talep' };
    if (navMap[e.key]) { e.preventDefault(); navigate(navMap[e.key]); return; }
  }

  if (e.key === '/' && !inInput) {
    const searchMap = { stok:'stok-search', hareket:'har-search', 'malzeme-ekle':'ekle-search' };
    const id = searchMap[S.aktifSayfa];
    if (id) { e.preventDefault(); document.getElementById(id)?.focus(); }
  }
});

// ── Expose on window ─────────────────────────────────────────────
window.S = S;
window.refreshAll = refreshAll;
window.navigate = navigate;
window.toggleSidebar = toggleSidebar;
window.handleDiger = handleDiger;
window.getDigerVal = getDigerVal;
window.sktDurum = sktDurum;
window.sktBadge = sktBadge;
window.closeModal = closeModal;
window.initKatSelects = initKatSelects;
window.initDepoSelects = initDepoSelects;
window.initBirimSelects = initBirimSelects;
window.katBadgeHTML = katBadgeHTML;
window.apiSave = apiSave;
window.apiReset = apiReset;
window.apiBackupOlustur = apiBackupOlustur;
window._AYARLAR_DEFAULT = AYARLAR_DEFAULT;

// ── INIT ─────────────────────────────────────────────────────────
(async () => {
  const alive = await apiPing();
  if (alive) {
    await apiLoad();
  } else {
    console.warn('Sunucu bulunamadı — yerel modda çalışıyor (veri kaybolabilir)');
    window.toast('⚠ Sunucu bağlantısı yok — veriler kaydedilmeyecek', 'error');
  }
  ayarlariYukle();
  talepListesiYukle();
  initStok();
  initSKT();
  initBirimSelects();
  initKatSelects();
  initDepoSelects();
  renderDashboard();

  // ── Lucide icons init ───────────────────────────────────────────
  if (window.lucide) {
    lucide.createIcons();
    // Wrap navigate so lucide icons are refreshed after each page change
    const _origNavigate = window.navigate;
    window.navigate = function(...args) {
      _origNavigate(...args);
      setTimeout(() => lucide.createIcons(), 50);
    };
  }
})();
