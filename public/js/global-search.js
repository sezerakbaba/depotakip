import { S, DEPO_META } from './state.js';
import { getAllItems, esc } from './ui-common.js';

// ═══════════════════════════════════════════════════════════════════
// GLOBAL ARAMA (Ctrl+K) — Stok · Depo · Talep no
// Klavye odaklı: ↑/↓ seçim, Enter git, Esc kapat.
// ═══════════════════════════════════════════════════════════════════

const MODAL_ID = 'modal-global-search';
const MAX_RESULTS = 40;

let _items = []; // o anki filtrelenmiş sonuçlar (flat)
let _sel = 0; // seçili index
let _wired = false;

// Tüm aranabilir kayıtları topla (her açılışta tazele — veri değişebilir).
function _buildIndex() {
  const idx = [];
  getAllItems().forEach((i) => {
    idx.push({
      type: 'Stok',
      icon: 'package',
      label: i.ad,
      sub: i.depo,
      run: () => _gotoStok(i.ad),
    });
  });
  Object.keys(DEPO_META).forEach((d) => {
    idx.push({
      type: 'Depo',
      icon: 'warehouse',
      label: d,
      sub: 'Depo detayları',
      run: () => window.goDetay?.(d),
    });
  });
  window.talepListesiYukle?.();
  (S._talepListesi || []).forEach((t) => {
    idx.push({
      type: 'Talep',
      icon: 'file-text',
      label: t.no || '(no yok)',
      sub: [t.birim, t.durum].filter(Boolean).join(' · ') || 'Talep',
      run: () => window.talepGoruntule?.(t.id),
    });
  });
  return idx;
}

function _gotoStok(ad) {
  window.navigate?.('stok');
  const inp = document.getElementById('stok-search');
  if (inp) {
    inp.value = ad;
    const clr = document.getElementById('stok-search-clear');
    if (clr) clr.style.display = '';
  }
  window.renderStok?.();
}

// Alaka skoru: küçük = daha alakalı. Etiket eşleşmesi alt-bilgi (depo)
// eşleşmesini yener — böylece "asansör" araması depo kartını, o depodaki
// onlarca stok kaydının altında gömülü bırakmaz.
function _score(it, needle) {
  const l = it.label.toLocaleLowerCase('tr');
  const s = it.sub.toLocaleLowerCase('tr');
  if (l.startsWith(needle)) return 0;
  if (l.includes(needle)) return 1;
  if (s.includes(needle)) return 2;
  return -1; // eşleşme yok
}

function _filter(q) {
  const all = _buildIndex();
  const needle = q.trim().toLocaleLowerCase('tr');
  if (!needle) return all.slice(0, MAX_RESULTS);
  return all
    .map((it) => ({ it, sc: _score(it, needle) }))
    .filter((x) => x.sc >= 0)
    .sort((a, b) => a.sc - b.sc) // stabil sıralama: eşit skorda kaynak sırası korunur
    .slice(0, MAX_RESULTS)
    .map((x) => x.it);
}

function _render() {
  const listEl = document.getElementById('gs-results');
  if (!listEl) return;
  if (_items.length === 0) {
    listEl.innerHTML = '<div class="gs-empty">Sonuç bulunamadı</div>';
    return;
  }
  if (_sel < 0) _sel = 0;
  if (_sel >= _items.length) _sel = _items.length - 1;
  listEl.innerHTML = _items
    .map(
      (it, i) => `
      <div class="gs-item${i === _sel ? ' gs-item--active' : ''}" data-gs-index="${i}" role="option" aria-selected="${i === _sel}">
        <span class="gs-item-icon"><i data-lucide="${it.icon}" class="icon-inline"></i></span>
        <span class="gs-item-label">${esc(it.label)}</span>
        <span class="gs-item-sub">${esc(it.sub)}</span>
        <span class="gs-item-type">${esc(it.type)}</span>
      </div>`,
    )
    .join('');
  if (window.lucide) window.lucide.createIcons();
  // Seçili olanı görünür tut
  listEl.querySelector('.gs-item--active')?.scrollIntoView({ block: 'nearest' });
}

function _refresh() {
  const q = document.getElementById('gs-input')?.value || '';
  _items = _filter(q);
  _sel = 0;
  _render();
}

function _pick(i) {
  const it = _items[i];
  if (!it) return;
  closeGlobalSearch();
  it.run();
}

export function openGlobalSearch() {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  _wire();
  const inp = document.getElementById('gs-input');
  if (inp) inp.value = '';
  modal.classList.add('open');
  _refresh();
  setTimeout(() => document.getElementById('gs-input')?.focus(), 40);
}

export function closeGlobalSearch() {
  document.getElementById(MODAL_ID)?.classList.remove('open');
}

// İlk açılışta event listener'ları bağla (data-action/inline JS yok → CSP-OK).
function _wire() {
  if (_wired) return;
  _wired = true;
  const inp = document.getElementById('gs-input');
  const listEl = document.getElementById('gs-results');
  if (inp) {
    inp.addEventListener('input', _refresh);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _sel = Math.min(_sel + 1, _items.length - 1);
        _render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _sel = Math.max(_sel - 1, 0);
        _render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        _pick(_sel);
      }
      // Esc: global modal handler (main.js) zaten kapatıyor.
    });
  }
  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('[data-gs-index]');
      if (row) _pick(parseInt(row.dataset.gsIndex, 10));
    });
    // Hover ile seçimi güncelle (fare + klavye uyumu)
    listEl.addEventListener('mousemove', (e) => {
      const row = e.target.closest('[data-gs-index]');
      if (!row) return;
      const i = parseInt(row.dataset.gsIndex, 10);
      if (i !== _sel) {
        _sel = i;
        _render();
      }
    });
  }
}

window.openGlobalSearch = openGlobalSearch;
window.closeGlobalSearch = closeGlobalSearch;
