import { S, AYARLAR_DEFAULT, DEPO_META, DEPO_BADGE, KAT_COLORS, PAGE_TITLES, STOK_INIT, SKT_INIT, API_URL } from './state.js';
import { esc, getKey, updateClock, checkKritikNotification, dClick } from './ui-common.js';
import { apiPing, apiLoad, apiSave, apiSaveSync, apiSaveFlush, apiBackupOlustur, apiReset } from './api.js';
import { renderDashboard } from './dashboard.js';
import { renderStok, katBadgeHTML } from './stok.js';
import { renderHareketList } from './hareket.js';
import { renderIstatistik } from './istatistik.js';
import { renderKritik, goDetay } from './kritik.js';
import { renderMalzemeEkleList } from './malzeme.js';
import { renderBackupList, refreshVeriYonet } from './veri.js';
import { initTalep, renderTalepListesi, talepListesiYukle } from './talep.js';
import { ayarlariYukle, ayarlariKaydet, applyTheme, renderAyarlar } from './ayarlar.js';
import { openGlobalSearch, globalSearch, setupGlobalSearch } from './search.js';

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
  if (diff < 0)   return { cls:'skt-gecmis', label: 'SKT GEÇTİ',      days: diff, icon:'shield-alert' };
  if (diff <= S.ayarlar.sktKritikGun) return { cls:'skt-kritik', label: diff+'g kaldı',   days: diff, icon:'alert-triangle' };
  if (diff <= S.ayarlar.sktUyariGun)  return { cls:'skt-uyari',  label: sktStr.slice(0,7), days: diff, icon:'clock' };
  return               { cls:'skt-ok',     label: sktStr.slice(0,7),  days: diff, icon:'check' };
}

export function sktBadge(sktStr) {
  if (!sktStr) return '';
  const d = sktDurum(sktStr);
  if (!d) return '';
  return '<span class="skt-badge '+d.cls+'" title="Son Kullanma: '+sktStr+'"><i data-lucide="'+d.icon+'" class="icon-inline"></i> '+d.label+'</span>';
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
  const ni = document.querySelector(`.nav-item[data-action="navigate"][data-arg="${page}"]`);
  if (ni) ni.classList.add('active');
  const tt = document.getElementById('topbar-title');
  if (tt) tt.textContent = PAGE_TITLES[page] || page;

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
      `<div class="filter-chip${aktifDepo==='Tümü'?' active':''}" data-depo="Tümü" ${dClick('setDepoFilter','Tümü')}>Tümü</div>` +
      depos.map(d => {
        const color = DEPO_META[d]?.color || 'var(--teal)';
        const aktif = aktifDepo === d;
        const style = aktif ? `--chip-color:${color};border-color:${color};background:${color};color:#fff` : '';
        return `<div class="filter-chip${aktif?' active':''}" data-depo="${esc(d)}" data-color="${color}" ${dClick('setDepoFilter',d,color)} style="${style}">${esc(d)}</div>`;
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
let _clockTimer = setInterval(updateClock, 1000);
// Sekme gizliyken interval'i durdur, görünür olunca tek bir tick ile yakala
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(_clockTimer);
    _clockTimer = null;
  } else if (_clockTimer == null) {
    updateClock();
    _clockTimer = setInterval(updateClock, 1000);
  }
});

// ── data-action click dispatcher ─────────────────────────────────
// Inline onclick'lerden delegation pattern'ine geçiş. Whitelist'tir:
// data-action="<key>" attribute'u olan element'e tıklanınca eşleşen
// fonksiyon çağrılır. data-arg, ikinci parametre olarak iletilir.
// Element'in kendisi (chip/buton vs.) ilk parametre.
function _stokSearchClear(el) {
  const inp = document.getElementById('stok-search'); if (inp) inp.value = '';
  if (el) el.style.display = 'none';
  if (typeof window.stokSayfa !== 'undefined') window.stokSayfa = 0;
  window.renderStok?.();
}
function _harFiltreTemizle() {
  ['harTarihBas','harTarihBit','harDepoFilter','harPersonelFilter'].forEach(k => { window[k] = ''; });
  ['har-tarih-bas','har-tarih-bit','har-depo-filter','har-personel-filter'].forEach(id => {
    const e = document.getElementById(id); if (e) e.value = '';
  });
  document.querySelectorAll('.har-tarih-chip').forEach(c => c.classList.remove('active'));
  if (typeof window.harSayfa !== 'undefined') window.harSayfa = 0;
  window.renderHareketList?.();
}
function _toggleStokSutunMenu() {
  document.getElementById('stok-sutun-menu')?.classList.toggle('open');
}
function _clickFileInput(_el, id) { document.getElementById(id)?.click(); }
function _removeById(_el, id) { document.getElementById(id)?.remove(); }
function _stopProp(_el, ...rest) {
  // event her zaman son arg. Kullanılmıyor; rest spread sadece imza için.
  // Tek başına eklenmesi gerekmiyor — özel handler'lar event.stopPropagation çağırır.
}

// ── Sayfalama: stok ────────────────────────────────────────────────
function _stokSayfaPrev() { if (S.stokSayfa > 0) { S.stokSayfa--; window.renderStok?.(); } }
function _stokSayfaNext() { S.stokSayfa++; window.renderStok?.(); }
function _stokSayfaGit(_el, p) { S.stokSayfa = +p; window.renderStok?.(); }
function _harSayfaPrev() { if (S.harSayfa > 0) { S.harSayfa--; window.renderHareketList?.(); } }
function _harSayfaNext() { S.harSayfa++; window.renderHareketList?.(); }
function _harSayfaGit(_el, p) { S.harSayfa = +p; window.renderHareketList?.(); }

// ── Stok KPI / filtre chip handler'ları ───────────────────────────
function _stokDurumKpi(_el, target) {
  S.stokDurumFilter = target ? (S.stokDurumFilter === target ? '' : target) : '';
  S.stokSayfa = 0;
  window.renderStok?.();
}
function _stokDepoChipTemizle() {
  S.stokDepoFilter = 'Tümü';
  document.querySelectorAll('.filter-chip[data-depo]').forEach(c => {
    c.classList.remove('active'); c.style.cssText = '';
  });
  document.querySelector(`.filter-chip[data-depo="Tümü"]`)?.classList.add('active');
  S.stokSayfa = 0;
  window.renderStok?.();
}
function _stokKatChipTemizle() {
  S.stokKatFilter = 'Tümü';
  const sel = document.getElementById('stok-kat-select');
  if (sel) sel.value = 'Tümü';
  S.stokSayfa = 0;
  window.renderStok?.();
}
function _stokDurumChipTemizle() {
  S.stokDurumFilter = ''; S.stokSayfa = 0; window.renderStok?.();
}
function _stokAramaTemizle() {
  const si = document.getElementById('stok-search');
  if (si) {
    si.value = '';
    const clr = document.getElementById('stok-search-clear');
    if (clr) clr.style.display = 'none';
  }
  S.stokSayfa = 0; window.renderStok?.();
}
function _stokTumFiltreleriTemizle() {
  S.stokDepoFilter = 'Tümü'; S.stokKatFilter = 'Tümü'; S.stokDurumFilter = '';
  const si = document.getElementById('stok-search');
  if (si) {
    si.value = '';
    const clr = document.getElementById('stok-search-clear');
    if (clr) clr.style.display = 'none';
  }
  document.querySelectorAll('.filter-chip').forEach(c => { c.classList.remove('active'); c.style.cssText = ''; });
  document.querySelector(`.filter-chip[data-depo="Tümü"]`)?.classList.add('active');
  const sel = document.getElementById('stok-kat-select');
  if (sel) sel.value = 'Tümü';
  S.stokSayfa = 0; window.renderStok?.();
}

// ── Stok sütun reset (ayarlar) ────────────────────────────────────
function _stokSutunSifirla() {
  S.ayarlar.stokSutunSirasi = [...window._AYARLAR_DEFAULT.stokSutunSirasi];
  S.ayarlar.stokSutunGizli = [];
  window.ayarlariKaydet?.();
  window.toast?.('Sütun düzeni sıfırlandı ✓');
}
function _tumAyarlariSifirla() {
  if (!confirm('Tüm ayarlar sıfırlanacak. Emin misiniz?')) return;
  localStorage.removeItem('depoAyarlar');
  S.ayarlar = { ...window._AYARLAR_DEFAULT };
  window.applyTheme?.();
  window.renderAyarlar?.();
  window.toast?.('Ayarlar sıfırlandı');
}

// ── Dashboard "Hızlı Giriş" (event stop) ──────────────────────────
function _dashHizliGiris(_el, dep, mal, e) {
  e?.stopPropagation?.();
  window.hizliHareket?.(dep, mal, 'Giriş');
}

// ── Yazı tipi boyutu (range input) ────────────────────────────────
function _yazitipiBoy(el) {
  const lbl = document.getElementById('yazitipiBoy-lbl');
  if (lbl) lbl.textContent = 'Şu an: ' + el.value + '%';
  window.setAyar?.('yazitipiBoy', +el.value);
  document.documentElement.style.fontSize = el.value + '%';
}

// ── setAyar wrapper'ları: this.value/this.checked/parse ───────────
function _setAyarStr(el, key)   { window.setAyar?.(key, el.value); }
function _setAyarTrim(el, key)  { window.setAyar?.(key, el.value.trim()); }
function _setAyarNum(el, key)   { window.setAyar?.(key, +el.value); }
function _setAyarBool(el, key)  { window.setAyar?.(key, el.checked); }
function _setAyarTalepOnPek(el) {
  window.setAyar?.('talepOnPek', el.value.trim().toUpperCase() || 'TLN');
}
function _toggleStokSutunChg(el, key) {
  window.toggleStokSutun?.(key, el.checked);
}
function _setTemaThen(_el, t) { window.setTema?.(t); _syncThemeToggleIcon(); }

// Tema toggle (topbar): light → dark → auto → light
const _TEMA_NEXT = { light: 'dark', dark: 'auto', auto: 'light' };
const _TEMA_ICON = { light: 'sun', dark: 'moon', auto: 'sun-moon' };
function _cycleTema() {
  const cur = S.ayarlar.tema || 'auto';
  window.setTema?.(_TEMA_NEXT[cur] || 'light');
  _syncThemeToggleIcon();
}
function _syncThemeToggleIcon() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const cur = S.ayarlar.tema || 'auto';
  const ico = _TEMA_ICON[cur] || 'sun-moon';
  btn.innerHTML = `<i data-lucide="${ico}"></i>`;
  btn.title = 'Tema: ' + cur + ' (değiştirmek için tıkla)';
  if (window.lucide) lucide.createIcons({ nodes: [btn] });
}
function _setTarihFormatThen(_el, fmt) {
  window.setAyar?.('tarihFormat', fmt);
  window.renderAyarlar?.();
}

// ── Ayarlar arama ──────────────────────────────────────────────────
function _ayarlarAraInput(el) { window.ayarlarAraOlay?.(el.value); }

// ── index.html'den taşınan kompleks inline handler'lar ────────────
function _stokSearchInput(el) {
  const clr = document.getElementById('stok-search-clear');
  if (clr) clr.style.display = el.value ? 'flex' : 'none';
  clearTimeout(window._stokST);
  window._stokST = setTimeout(() => { S.stokSayfa = 0; window.renderStok?.(); }, 220);
}
function _harSearchInput() {
  clearTimeout(window._harST);
  window._harST = setTimeout(() => { S.harSayfa = 0; window.renderHareketList?.(); }, 220);
}
function _harDepoFilterChg(el) {
  S.harDepoFilter = el.value; S.harSayfa = 0; window.renderHareketList?.();
}
function _harPersonelFilterInp(el) {
  S.harPersonelFilter = el.value; S.harSayfa = 0; window.renderHareketList?.();
}
function _harTarihBasChg(el) {
  S.harTarihBas = el.value;
  document.querySelectorAll('.har-tarih-chip').forEach(c => c.classList.remove('active'));
  S.harSayfa = 0; window.renderHareketList?.();
}
function _harTarihBitChg(el) {
  S.harTarihBit = el.value;
  document.querySelectorAll('.har-tarih-chip').forEach(c => c.classList.remove('active'));
  S.harSayfa = 0; window.renderHareketList?.();
}
function _toggleYeniSKTChg(el) { window.toggleYeniSKT?.(el.value); }

const ACTIONS = {
  navigate:             (_el, arg) => navigate(arg),
  closeModal:           (_el, arg) => closeModal(arg),
  toggleSidebar:        () => toggleSidebar(),
  print:                () => window.print(),
  toggleStokSutunMenu:  _toggleStokSutunMenu,
  stokSearchClear:      _stokSearchClear,
  harFiltreTemizle:     _harFiltreTemizle,
  clickFileInput:       _clickFileInput,
  removeById:           _removeById,
  setDurumFilter:       (el, arg) => window.setDurumFilter?.(el, arg),
  setHarFilter:         (el, arg) => window.setHarFilter?.(el, arg),
  setHarTarihShortcut:  (_el, arg) => window.setHarTarihShortcut?.(arg),
  setHarMod:            (_el, arg) => window.setHarMod?.(arg),
  topluHarSatirEkle:    () => window.topluHarSatirEkle?.(),
  topluHarKaydet:       () => window.topluHarKaydet?.(),
  talepKaydet:          (_el, arg) => window.talepKaydet?.(arg),
  // Stok
  stokSort:             (_el, arg) => window.stokSort?.(arg),
  setKatFilterSel:      (el) => window.setKatFilterSel?.(el.value),
  setDepoFilter:        (el, val, color) => window.setDepoFilter?.(el, val, color),
  openStokModal:        (_el, key, dep, mal) => window.openStokModal?.(key, dep, mal),
  openMalHareket:       (_el, dep, mal) => window.openMalHareket?.(dep, mal),
  hizliHareket:         (_el, dep, mal, tur) => window.hizliHareket?.(dep, mal, tur),
  dashHizliGiris:       _dashHizliGiris,
  goDetay:              (_el, dep) => window.goDetay?.(dep),
  // Stok sayfalama / KPI / filtre chips
  stokSayfaPrev:        _stokSayfaPrev,
  stokSayfaNext:        _stokSayfaNext,
  stokSayfaGit:         _stokSayfaGit,
  stokDurumKpi:         _stokDurumKpi,
  stokDepoChipTemizle:  _stokDepoChipTemizle,
  stokKatChipTemizle:   _stokKatChipTemizle,
  stokDurumChipTemizle: _stokDurumChipTemizle,
  stokAramaTemizle:     _stokAramaTemizle,
  stokTumFiltreleriTemizle: _stokTumFiltreleriTemizle,
  // Hareket
  harSayfaPrev:         _harSayfaPrev,
  harSayfaNext:         _harSayfaNext,
  harSayfaGit:          _harSayfaGit,
  hareketSil:           (_el, id, mal, dep, tur, mik) =>
                           window.hareketSil?.(+id, mal, dep, tur, +mik),
  _harEklenenSil:       (_el, idx) => window._harEklenenSil?.(+idx),
  _harMalSec:           (_el, dep, mal) => window._harMalSec?.(dep, mal),
  // Talep
  talepMalModalAc:      (_el, n) => window.talepMalModalAc?.(+n),
  talepMalTemizle:      (_el, n) => window.talepMalTemizle?.(+n),
  _talepMalDepuSec:     (_el, dep) => window._talepMalDepuSec?.(dep),
  _talepMalModalSec:    (_el, val, ad, dep, birim, mevcut, min) =>
                           window._talepMalModalSec?.(val, ad, dep, birim, +mevcut, +min),
  talepSatirSil:        (_el, n) => window.talepSatirSil?.(+n),
  talepDurumGuncelle:   (_el, id, dur) => window.talepDurumGuncelle?.(+id, dur),
  talepGoruntule:       (_el, id) => window.talepGoruntule?.(+id),
  // Ayarlar
  setTema:              _setTemaThen,
  cycleTema:            _cycleTema,
  openGlobalSearch:     () => openGlobalSearch(),
  setTarihFormat:       _setTarihFormatThen,
  birimSil:             (_el, b) => window.birimSil?.(b),
  birimEkle:            () => window.birimEkle?.(),
  ekDepoEkle:           () => window.ekDepoEkle?.(),
  ekKatEkle:            () => window.ekKatEkle?.(),
  depoYeniAdDlg:        (_el, ad) => window.depoYeniAdDlg?.(ad),
  depoYeniAdKaydet:     (_el, ad) => window.depoYeniAdKaydet?.(ad),
  katYeniAdDlg:         (_el, ad) => window.katYeniAdDlg?.(ad),
  katYeniAdKaydet:      (_el, ad) => window.katYeniAdKaydet?.(ad),
  renderAyarlar:        () => window.renderAyarlar?.(),
  setAyarlarTab:        (_el, id) => window.setAyarlarTab?.(id),
  ayarlarAraTemizle:    () => window.ayarlarAraOlay?.(''),
  bildirimIzniSor:      () => window.bildirimIzniSor?.(),
  stokSutunSifirla:     _stokSutunSifirla,
  tumAyarlariSifirla:   _tumAyarlariSifirla,
  // Malzeme
  malzemeSil:           (_el, dep, ad) => window.malzemeSil?.(dep, ad),
  // Veri
  apiBackupLoad:        (_el, dosya) => window.apiBackupLoad?.(dosya),
  // Parametresiz window-export'lu fonksiyonlar
  apiBackupOlustur: () => window.apiBackupOlustur?.(),
  renderBackupList: () => window.renderBackupList?.(),
  veriDisaAktar:    () => window.veriDisaAktar?.(),
  veriExcelAktar:   () => window.veriExcelAktar?.(),
  veriSifirla:      () => window.veriSifirla?.(),
  renderTalepListesi:() => window.renderTalepListesi?.(),
  kaydetHareket:    () => window.kaydetHareket?.(),
  clearHareketForm: () => window.clearHareketForm?.(),
  toggleNotZorunlu: () => window.toggleNotZorunlu?.(),
  exportHareketExcel:() => window.exportHareketExcel?.(),
  kritikTalepAktar: () => window.kritikTalepAktar?.(),
  talepOnayaGonder: () => window.talepOnayaGonder?.(),
  talepSifirla:     () => window.talepSifirla?.(),
  talepAyarlaraKaydet:() => window.talepAyarlaraKaydet?.(),
  talepSatirEkle:   () => window.talepSatirEkle?.(),
  malzemeEkle:      () => window.malzemeEkle?.(),
  _harEkle:         () => window._harEkle?.(),
  _harMalTemizle:   () => window._harMalTemizle?.(),
  saveStok:         () => window.saveStok?.(),
};

const CHANGES = {
  setAyarStr:           _setAyarStr,
  setAyarTrim:          _setAyarTrim,
  setAyarNum:           _setAyarNum,
  setAyarBool:          _setAyarBool,
  setAyarTalepOnPek:    _setAyarTalepOnPek,
  setKatFilterSel:      (el) => window.setKatFilterSel?.(el.value),
  toggleStokSutun:      _toggleStokSutunChg,
  handleDiger:          (el, digerId) => handleDiger(el, digerId),
  topluHarDepChange:    (el, rowId) => window.topluHarDepChange?.(el, rowId),
  talepAciliyetGuncelle:(el) => window.talepAciliyetGuncelle?.(el),
  veriIceAktar:         (el) => window.veriIceAktar?.(el),
  // index.html
  harDepoFilter:        _harDepoFilterChg,
  harTarihBas:          _harTarihBasChg,
  harTarihBit:          _harTarihBitChg,
  toggleYeniSKT:        _toggleYeniSKTChg,
  renderTalepListesi:   () => window.renderTalepListesi?.(),
  renderMalzemeEkleList:() => window.renderMalzemeEkleList?.(),
};

const INPUTS = {
  yazitipiBoy:          _yazitipiBoy,
  ayarlarAra:           _ayarlarAraInput,
  _harMalAra:           (el) => window._harMalAra?.(el.value),
  updateTalepToplam:    () => window.updateTalepToplam?.(),
  // index.html
  stokSearch:           _stokSearchInput,
  harSearch:            _harSearchInput,
  harPersonelFilter:    _harPersonelFilterInp,
  _talepMalModalRender: () => window._talepMalModalRender?.(),
  renderMalzemeEkleList:() => window.renderMalzemeEkleList?.(),
  globalSearch:         (el) => globalSearch(el),
};

const KEYDOWNS = {
  birimEkle:            () => window.birimEkle?.(),
};

function _parseArgs(el) {
  if (el.dataset.args) {
    try { return JSON.parse(el.dataset.args); } catch { return []; }
  }
  if (el.dataset.arg !== undefined) return [el.dataset.arg];
  return [];
}

// ── Global click handler ─────────────────────────────────────────
document.addEventListener('click', e => {
  // 1) data-action delegation
  const trigger = e.target.closest('[data-action]');
  if (trigger) {
    const fn = ACTIONS[trigger.dataset.action];
    if (fn) {
      const args = _parseArgs(trigger);
      fn(trigger, ...args, e);
      return;
    }
  }
  // 2) Açık dropdown/menü'leri kapat
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

// ── Global change / input / keydown dispatcher'ları ──────────────
document.addEventListener('change', e => {
  const trigger = e.target.closest('[data-change]');
  if (!trigger) return;
  const fn = CHANGES[trigger.dataset.change];
  if (!fn) return;
  fn(trigger, ..._parseArgs(trigger), e);
});

document.addEventListener('input', e => {
  const trigger = e.target.closest('[data-input]');
  if (!trigger) return;
  const fn = INPUTS[trigger.dataset.input];
  if (!fn) return;
  fn(trigger, ..._parseArgs(trigger), e);
});

document.addEventListener('keydown', e => {
  const trigger = e.target.closest('[data-keydown]');
  if (!trigger) return;
  const filter = trigger.dataset.key;
  if (filter && e.key !== filter) return;
  const fn = KEYDOWNS[trigger.dataset.keydown];
  if (!fn) return;
  fn(trigger, e, ..._parseArgs(trigger));
});

// ═════════════════════════════════════════════════════════════════
// Erişilebilirlik (Aşama G)
// ═════════════════════════════════════════════════════════════════

// 1) Tıklanabilir non-button [data-action] elemanlarına klavye erişimi.
//    Mevcut <div data-action="..."> elementleri (nav-item, filter-chip,
//    kpi-kart, c-depo-card vb.) gerçek <button>'a dönüştürmek HTML+CSS
//    refactor'ü olur; bu hafif yaklaşım Enter/Space'i click'e map eder ve
//    role="button"/tabindex="0" set eder.
const _A11Y_SKIP = new Set(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL']);
function _a11yEnhance(root = document) {
  root.querySelectorAll('[data-action], [data-change], [data-input], [data-keydown]').forEach(el => {
    if (_A11Y_SKIP.has(el.tagName)) return;
    if (!el.hasAttribute('role'))     el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  });
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const trigger = e.target.closest('[data-action]');
  if (!trigger || _A11Y_SKIP.has(trigger.tagName)) return;
  // Form alanı içindeysek müdahale etme
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  e.preventDefault();
  trigger.click();
});

// Dinamik render edilen (innerHTML ile eklenen) içerik için MutationObserver
const _a11yObserver = new MutationObserver(muts => {
  for (const m of muts) {
    for (const node of m.addedNodes) {
      if (node.nodeType === 1) _a11yEnhance(node);
    }
  }
});
_a11yObserver.observe(document.body, { childList: true, subtree: true });

// 2) Modal yönetimi: ESC kapatır, açılınca focus girer, kapanınca
//    önceki focus'a döner. Basit focus trap (Tab/Shift+Tab cycle).
const _modalFocusStack = [];

function _focusableIn(el) {
  return [...el.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(n => n.offsetWidth > 0 || n.offsetHeight > 0);
}

function _topOpenModal() {
  const open = [...document.querySelectorAll('.modal-overlay.open')];
  return open[open.length - 1] || null;
}

// ARIA attrs ve focus handling
const _modalObserver = new MutationObserver(muts => {
  for (const m of muts) {
    if (m.attributeName !== 'class' || !m.target.classList.contains('modal-overlay')) continue;
    const overlay = m.target;
    const opened = overlay.classList.contains('open');
    const wasOpen = m.oldValue?.includes('open');
    if (opened && !wasOpen) {
      // ARIA
      const modal = overlay.querySelector('.modal');
      if (modal) {
        if (!modal.hasAttribute('role'))      modal.setAttribute('role', 'dialog');
        if (!modal.hasAttribute('aria-modal')) modal.setAttribute('aria-modal', 'true');
        const title = modal.querySelector('.modal-title');
        if (title && !modal.hasAttribute('aria-labelledby')) {
          if (!title.id) title.id = 'modal-title-' + Math.random().toString(36).slice(2, 8);
          modal.setAttribute('aria-labelledby', title.id);
        }
      }
      // Focus
      _modalFocusStack.push(document.activeElement);
      setTimeout(() => {
        const focusables = modal ? _focusableIn(modal) : [];
        (focusables[0] || modal)?.focus?.();
      }, 30);
    } else if (!opened && wasOpen) {
      const prev = _modalFocusStack.pop();
      prev?.focus?.();
    }
  }
});
_modalObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ['class'],
  attributeOldValue: true,
  subtree: true,
});

document.addEventListener('keydown', e => {
  const top = _topOpenModal();
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    top.classList.remove('open');
    return;
  }
  if (e.key === 'Tab') {
    const modal = top.querySelector('.modal');
    const focusables = modal ? _focusableIn(modal) : [];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
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

// ── Unload sırasında pending save'i flush et ─────────────────────
// 800ms debounce içinde sekme kapanırsa son yazımı kaybetmeyelim.
// visibilitychange (mobil/sekme gizleme) için de tetikle.
window.addEventListener('pagehide', apiSaveFlush);
window.addEventListener('beforeunload', apiSaveFlush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') apiSaveFlush();
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
window.apiSaveSync = apiSaveSync;
window.apiLoad = apiLoad;
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
  document.title = (S.ayarlar.kurumAdi || 'Depo Yönetim Sistemi') + ' — Depo Takip';
  _syncThemeToggleIcon();
  _a11yEnhance();
  setupGlobalSearch();
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
