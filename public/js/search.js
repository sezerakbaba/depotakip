// ═══════════════════════════════════════════════════════════════════
// Global Arama (Ctrl+K)
// Stok + talep + depo arar. Klavye odaklı: ↑/↓ gezin, Enter aç,
// ESC kapat. Tip-as-you-go, 200ms debounce.
// ═══════════════════════════════════════════════════════════════════
import { S, DEPO_META } from './state.js';
import { getAllItems, getStok, durum, esc } from './ui-common.js';

let _selectedIdx = 0;
let _currentResults = [];
let _debounceT = null;

export function openGlobalSearch() {
  const m  = document.getElementById('modal-search');
  if (!m) return;
  m.classList.add('open');
  const inp = document.getElementById('search-input');
  if (inp) {
    inp.value = '';
    setTimeout(() => inp.focus(), 30);
  }
  _selectedIdx = 0;
  _renderResults('');
}

export function closeGlobalSearch() {
  document.getElementById('modal-search')?.classList.remove('open');
}

// data-input="globalSearch" tetiklendiğinde
export function globalSearch(el) {
  clearTimeout(_debounceT);
  _debounceT = setTimeout(() => {
    _selectedIdx = 0;
    _renderResults(el.value);
  }, 150);
}

function _highlight(text, q) {
  if (!q) return esc(text);
  const t = String(text);
  const idx = t.toLowerCase().indexOf(q);
  if (idx < 0) return esc(t);
  return esc(t.slice(0, idx))
       + '<mark class="search-item-mark">' + esc(t.slice(idx, idx + q.length)) + '</mark>'
       + esc(t.slice(idx + q.length));
}

function _gather(q) {
  const ql = q.toLowerCase().trim();
  if (!ql) return [];

  const results = [];
  // Stok malzemeler
  for (const i of getAllItems()) {
    const adMatch  = i.ad.toLowerCase().includes(ql);
    const depMatch = i.depo.toLowerCase().includes(ql);
    if (!adMatch && !depMatch) continue;
    const s = getStok(i.depo, i.ad);
    const d = durum(s.mevcut, s.min, s.max);
    results.push({
      group: 'Stok',
      icon: 'package',
      title: i.ad,
      sub: i.depo + ' · Mevcut: ' + s.mevcut + (d === 'Kritik' ? ' · KRİTİK' : ''),
      titleHtml: _highlight(i.ad, ql),
      subHtml:   _highlight(i.depo, ql) + ' · Mevcut: ' + s.mevcut + (d === 'Kritik' ? ' · <span style="color:var(--danger)">KRİTİK</span>' : ''),
      action: () => {
        closeGlobalSearch();
        window.navigate?.('stok');
        setTimeout(() => window.openStokModal?.(i.depo + '||' + i.ad, i.depo, i.ad), 60);
      },
    });
    if (results.length >= 40) break;
  }
  // Depolar
  for (const [dep, meta] of Object.entries(DEPO_META)) {
    if (!dep.toLowerCase().includes(ql)) continue;
    results.push({
      group: 'Depo',
      icon: 'warehouse',
      title: dep,
      sub: 'Kod: ' + meta.kod,
      titleHtml: _highlight(dep, ql),
      subHtml: 'Kod: ' + esc(meta.kod),
      action: () => {
        closeGlobalSearch();
        window.goDetay?.(dep);
      },
    });
  }
  // Talepler
  for (const t of (S._talepListesi || [])) {
    const no   = String(t.no || '').toLowerCase();
    const bir  = String(t.birim || '').toLowerCase();
    const per  = String(t.personel || '').toLowerCase();
    if (!no.includes(ql) && !bir.includes(ql) && !per.includes(ql)) continue;
    results.push({
      group: 'Talep',
      icon: 'file-text',
      title: t.no || '—',
      sub: [t.birim, t.personel, t.durum].filter(Boolean).join(' · '),
      titleHtml: _highlight(t.no || '—', ql),
      subHtml:   esc([t.birim, t.personel, t.durum].filter(Boolean).join(' · ')),
      action: () => {
        closeGlobalSearch();
        window.talepGoruntule?.(t.id);
      },
    });
  }
  return results.slice(0, 50);
}

function _renderResults(q) {
  _currentResults = _gather(q);
  const el = document.getElementById('search-results');
  if (!el) return;

  if (!q.trim()) {
    el.innerHTML = '<div class="search-empty">Stok, depo veya talep adı yazın…</div>';
    return;
  }
  if (_currentResults.length === 0) {
    el.innerHTML = '<div class="search-empty">Sonuç bulunamadı.</div>';
    return;
  }

  // Grupla
  const groups = {};
  _currentResults.forEach((r, i) => {
    if (!groups[r.group]) groups[r.group] = [];
    groups[r.group].push({ ...r, idx: i });
  });

  const html = Object.entries(groups).map(([g, items]) => `
    <div class="search-group-label">${esc(g)} (${items.length})</div>
    ${items.map(r => `
      <div class="search-item${r.idx === _selectedIdx ? ' active' : ''}" data-idx="${r.idx}">
        <span class="search-item-icon"><i data-lucide="${r.icon}"></i></span>
        <div class="search-item-body">
          <div class="search-item-title">${r.titleHtml}</div>
          <div class="search-item-sub">${r.subHtml}</div>
        </div>
      </div>
    `).join('')}
  `).join('');

  el.innerHTML = html;
  if (window.lucide) lucide.createIcons({ nodes: [el] });
  _scrollActiveIntoView();
}

function _scrollActiveIntoView() {
  const wrap   = document.getElementById('search-results');
  const active = wrap?.querySelector('.search-item.active');
  active?.scrollIntoView({ block: 'nearest' });
}

function _move(delta) {
  if (_currentResults.length === 0) return;
  _selectedIdx = (_selectedIdx + delta + _currentResults.length) % _currentResults.length;
  // Yalnızca active class'ı güncelle
  const wrap = document.getElementById('search-results');
  wrap?.querySelectorAll('.search-item').forEach(el => {
    el.classList.toggle('active', +el.dataset.idx === _selectedIdx);
  });
  _scrollActiveIntoView();
}

// Modal açıkken klavye event'lerini yakala (modal focus trap'inden önce)
export function setupGlobalSearch() {
  // Ctrl+K / Cmd+K → aç
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openGlobalSearch();
    }
  });

  // Modal-içi klavye nav (capture phase ki modal trap'tan önce çalışsın)
  document.addEventListener('keydown', e => {
    const m = document.getElementById('modal-search');
    if (!m || !m.classList.contains('open')) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); _move(+1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _move(-1); }
    else if (e.key === 'Enter')   { e.preventDefault(); _activateSelected(); }
  }, true);

  // Mouse tıklamasıyla seçim — delegation
  document.getElementById('search-results')?.addEventListener('click', e => {
    const item = e.target.closest('.search-item');
    if (!item) return;
    _selectedIdx = +item.dataset.idx;
    _activateSelected();
  });
}

function _activateSelected() {
  const r = _currentResults[_selectedIdx];
  if (r) r.action();
}

// Window exposure
window.openGlobalSearch = openGlobalSearch;
window.closeGlobalSearch = closeGlobalSearch;
window.globalSearch = globalSearch;
