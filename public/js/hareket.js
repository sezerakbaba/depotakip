import { S, KAYNAK } from './state.js';
import { getAllItems, getStok, getDepoItems, durum, durumBadge, depoBadge, esc, escQ, fmt, getKey, timeAgo } from './ui-common.js';

// ═══════════════════════════════════════════════════════════════════
// GİRİŞ / ÇIKIŞ
// ═══════════════════════════════════════════════════════════════════

export function updateHareketStokBilgi() {
  const dep = document.getElementById('h-depo')?.value;
  const mal = document.getElementById('h-malzeme')?.value;
  const infoEl = document.getElementById('h-stok-bilgi');
  if (!infoEl) return;
  if (!dep || !mal) { infoEl.style.display='none'; return; }
  const s = getStok(dep, mal);
  const d = durum(s.mevcut, s.min, s.max);
  const color = d==='Kritik' ? 'var(--red)' : d==='Fazla' ? 'var(--amber)' : 'var(--teal)';
  const mm = S.malzemeMeta[getKey(dep,mal)]||{};
  infoEl.style.display = 'flex';
  infoEl.innerHTML = `
    <span style="font-size:11px;color:var(--muted)">Mevcut:</span>
    <strong style="font-size:14px;color:${color};font-family:'IBM Plex Mono',monospace">${s.mevcut}${mm.birim?' '+mm.birim:''}</strong>
    <span style="font-size:11px;color:var(--muted)">Min: ${s.min} / Max: ${s.max}</span>
    <span style="margin-left:auto">${durumBadge(d)}</span>`;
}

export function setHarTarihShortcut(mod) {
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
  S.harTarihBas = bas; S.harTarihBit = bit;
  document.getElementById('har-tarih-bas').value = bas;
  document.getElementById('har-tarih-bit').value = bit;
  document.querySelectorAll('.har-tarih-chip').forEach(c => c.classList.remove('active'));
  document.querySelector(`.har-tarih-chip[data-mod="${mod}"]`)?.classList.add('active');
  S.harSayfa = 0; renderHareketList();
}

export function setHarFilter(el, val) {
  document.querySelectorAll('.filter-chip[data-htur]').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  S.harFilter = val;
  renderHareketList();
}

export function _harEkle() {
  const dep = document.getElementById('h-depo').value;
  const mal = document.getElementById('h-malzeme').value;
  const tur = document.getElementById('h-tur').value;
  const mik = parseInt(document.getElementById('h-miktar').value);
  if (!dep || !mal) { window.toast('Malzeme seçin', 'error'); return; }
  if (!mik || mik <= 0) { window.toast('Geçerli miktar girin', 'error'); return; }
  S._harEklenenler.push({ dep, mal, tur, mik });
  _renderHarEklenenler();
  _harMalTemizle();
  document.getElementById('h-miktar').value = '';
  document.getElementById('h-ekle-satir').style.display = 'none';
  document.getElementById('h-mal-search').focus();
}

export function _harEklenenSil(idx) {
  S._harEklenenler.splice(idx, 1);
  _renderHarEklenenler();
}

export function _renderHarEklenenler() {
  const wrap = document.getElementById('h-eklenenler-wrap');
  const list = document.getElementById('h-eklenenler-list');
  const sayi = document.getElementById('h-eklenen-sayi');
  if (!wrap || !list) return;
  if (!S._harEklenenler.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (sayi) sayi.textContent = S._harEklenenler.length;
  list.innerHTML = S._harEklenenler.map((h, i) => `
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

export function kaydetHareket() {
  if (!S._harEklenenler.length) { window.toast('En az 1 malzeme ekleyin', 'error'); return; }
  const belge = document.getElementById('h-belge').value;
  const pers  = document.getElementById('h-personel').value;
  const not   = document.getElementById('h-not').value;
  if ((S.notZorunlu || S.ayarlar.hareketNot) && !not.trim()) { window.toast('Not alanı zorunlu!', 'error'); document.getElementById('h-not')?.focus(); return; }
  for (const h of S._harEklenenler) {
    const s = getStok(h.dep, h.mal);
    if (h.tur === 'Çıkış' && s.mevcut < h.mik) {
      window.toast(`Yetersiz stok: ${h.mal} (Mevcut: ${s.mevcut})`, 'error'); return;
    }
  }
  const now = new Date().toISOString();
  S._harEklenenler.forEach(h => {
    const s = getStok(h.dep, h.mal);
    s.mevcut = h.tur === 'Giriş' ? s.mevcut + h.mik : s.mevcut - h.mik;
    S.hareketler.push({ id: Date.now()+'-'+Math.random().toString(36).slice(2,7),
      tarih: now, depo: h.dep, malzeme: h.mal, tur: h.tur, miktar: h.mik, belge, personel: pers, not });
  });
  const n = S._harEklenenler.length;
  clearHareketForm();
  renderHareketList();
  window.refreshAll();
  window.toast(`${n} hareket kaydedildi ✓`);
}

export function clearHareketForm() {
  ['h-belge','h-personel','h-not'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('h-miktar').value = '';
  document.getElementById('h-ekle-satir').style.display = 'none';
  S._harEklenenler = [];
  _renderHarEklenenler();
  _harMalTemizle();
}

export function _harMalAra(q) {
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

export function _harMalSec(dep, mal) {
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

export function _harMalTemizle() {
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
export function hareketSil(id) {
  const idx = S.hareketler.findIndex(h=>h.id===id);
  if (idx===-1) return;
  const h = S.hareketler[idx];
  if (!confirm(`"${h.malzeme}" hareketini silmek istediğinizden emin misiniz?\n${h.tur} · ${h.miktar} adet · ${new Date(h.tarih).toLocaleDateString("tr-TR")}\nStok geri alınacak.`)) return;
  const s = getStok(h.depo, h.malzeme);
  // Ters işlem
  s.mevcut = h.tur==='Giriş' ? s.mevcut-h.miktar : s.mevcut+h.miktar;
  if (s.mevcut < 0) s.mevcut = 0;
  S.hareketler.splice(idx, 1);
  renderHareketList();
  window.refreshAll();
  window.toast('Hareket silindi, stok güncellendi.');
}

export function renderHareketList() {
  const q      = (document.getElementById('har-search')?.value||'').toLowerCase();
  const list   = document.getElementById('hareket-list');
  const spEl   = document.getElementById('har-sayfalama');
  const ozEl   = document.getElementById('har-ozet');
  if (!list) return;

  // Filtrele
  const filtered = S.hareketler.filter(h => {
    if (S.harFilter !== 'Tümü' && h.tur !== S.harFilter) return false;
    if (S.harDepoFilter && h.depo !== S.harDepoFilter) return false;
    if (S.harPersonelFilter && !(h.personel||'').toLowerCase().includes(S.harPersonelFilter.toLowerCase())) return false;
    if (q && !h.malzeme.toLowerCase().includes(q) && !h.depo.toLowerCase().includes(q) &&
        !(h.personel||'').toLowerCase().includes(q) && !(h.belge||'').toLowerCase().includes(q)) return false;
    if (S.harTarihBas) {
      const hd = new Date(h.tarih); hd.setHours(0,0,0,0);
      if (hd < new Date(S.harTarihBas + 'T00:00:00')) return false;
    }
    if (S.harTarihBit) {
      const hd = new Date(h.tarih); hd.setHours(0,0,0,0);
      if (hd > new Date(S.harTarihBit + 'T00:00:00')) return false;
    }
    return true;
  }).slice().reverse();

  // ── Özet kartlar ──────────────────────────────────────────────
  if (ozEl) {
    const today = new Date().toDateString();
    const bugunGiris  = S.hareketler.filter(h => h.tur==='Giriş'  && new Date(h.tarih).toDateString()===today).length;
    const bugunCikis  = S.hareketler.filter(h => h.tur==='Çıkış'  && new Date(h.tarih).toDateString()===today).length;
    const toplam      = S.hareketler.length;
    // En aktif malzeme
    const malSay = {};
    S.hareketler.forEach(h => { malSay[h.malzeme] = (malSay[h.malzeme]||0)+1; });
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
  const toplamSayfa = Math.ceil(filtered.length / S.ayarlar.harSayfaBoy);
  if (S.harSayfa >= toplamSayfa) S.harSayfa = toplamSayfa - 1;
  const sayfa = filtered.slice(S.harSayfa * S.ayarlar.harSayfaBoy, (S.harSayfa+1) * S.ayarlar.harSayfaBoy);

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
    let btns = `<button class="sayfa-btn" onclick="S.harSayfa--;renderHareketList()" ${S.harSayfa===0?'disabled':''}>‹</button>`;
    const start = Math.max(0, S.harSayfa-2), end2 = Math.min(toplamSayfa, S.harSayfa+3);
    if (start > 0) btns += `<span class="sayfa-info">…</span>`;
    for (let p=start; p<end2; p++) {
      btns += `<button class="sayfa-btn ${p===S.harSayfa?'aktif':''}" onclick="S.harSayfa=${p};renderHareketList()">${p+1}</button>`;
    }
    if (end2 < toplamSayfa) btns += `<span class="sayfa-info">…</span>`;
    btns += `<button class="sayfa-btn" onclick="S.harSayfa++;renderHareketList()" ${S.harSayfa===toplamSayfa-1?'disabled':''}>›</button>`;
    btns += `<span class="sayfa-info">${filtered.length} kayıt · Sayfa ${S.harSayfa+1}/${toplamSayfa}</span>`;
    spEl.innerHTML = btns;
  }
}

export function toggleNotZorunlu() {
  S.notZorunlu = !S.notZorunlu;
  const btn = document.getElementById('not-zorunlu-btn');
  const lbl = document.getElementById('h-not-label');
  if (btn) btn.classList.toggle('active', S.notZorunlu);
  if (lbl) lbl.textContent = S.notZorunlu ? 'Not (zorunlu)' : 'Not (opsiyonel)';
  if (lbl) lbl.classList.toggle('har-not-lbl-aktif', S.notZorunlu);
}

export function openMalHareket(dep, mal) {
  const title = document.getElementById('modal-mal-har-title');
  const ozet  = document.getElementById('modal-mal-har-ozet');
  const liste = document.getElementById('modal-mal-har-liste');
  if (!title||!ozet||!liste) return;

  title.textContent = mal + ' — Hareket Geçmişi';

  const malHar = S.hareketler.filter(h => h.depo===dep && h.malzeme===mal)
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

export function hizliHareket(dep, mal, tur) {
  const mikStr = prompt(`${mal}\n${tur} miktarı girin:`, '1');
  if (!mikStr) return;
  const mik = parseInt(mikStr);
  if (!mik || mik <= 0) { window.toast('Geçersiz miktar!', 'error'); return; }
  const s = getStok(dep, mal);
  if (tur === 'Çıkış' && s.mevcut < mik) { window.toast('Yetersiz stok! Mevcut: ' + s.mevcut, 'error'); return; }
  s.mevcut = tur === 'Giriş' ? s.mevcut + mik : s.mevcut - mik;
  S.hareketler.push({
    id: Date.now()+'-'+Math.random().toString(36).slice(2,7),
    tarih: new Date().toISOString(),
    depo: dep, malzeme: mal, tur, miktar: mik, belge: '', personel: '', not: 'Hızlı hareket'
  });
  window.refreshAll();
  window.toast(`${tur} kaydedildi: ${mal} (${mik})`);
}

// ── Toplu Hareket ─────────────────────────────────────────────────
export function setHarMod(mod) {
  S.harMod = mod;
  document.getElementById('toplu-har-panel').style.display = mod==='toplu' ? 'block' : 'none';
  document.getElementById('har-mod-tek').classList.toggle('active', mod==='tek');
  document.getElementById('har-mod-toplu').classList.toggle('active', mod==='toplu');
  if (mod==='toplu' && document.getElementById('toplu-har-rows').children.length===0) topluHarSatirEkle();
}

export function topluHarSatirEkle() {
  const id = 'thr-' + (++S.topluHarCount);
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

export function topluHarDepChange(sel, rowId) {
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

export function topluHarKaydet() {
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
    S.hareketler.push({ id: Date.now()+'-'+Math.random().toString(36).slice(2,7),
      tarih: new Date().toISOString(), depo:dep, malzeme:mal, tur, miktar:mik,
      belge:'', personel:'', not:'Toplu kayıt' });
    saved++;
  });
  if (errors.length) window.toast('Hatalar: ' + errors.join(', '), 'error');
  if (saved > 0) {
    window.refreshAll();
    document.getElementById('toplu-har-rows').innerHTML = '';
    topluHarSatirEkle();
    window.toast(saved + ' hareket kaydedildi ✓');
  }
}

// Expose on window for inline handlers
window.updateHareketStokBilgi = updateHareketStokBilgi;
window.setHarTarihShortcut = setHarTarihShortcut;
window.setHarFilter = setHarFilter;
window._harEkle = _harEkle;
window._harEklenenSil = _harEklenenSil;
window.kaydetHareket = kaydetHareket;
window.clearHareketForm = clearHareketForm;
window._harMalAra = _harMalAra;
window._harMalSec = _harMalSec;
window._harMalTemizle = _harMalTemizle;
window.hareketSil = hareketSil;
window.toggleNotZorunlu = toggleNotZorunlu;
window.openMalHareket = openMalHareket;
window.hizliHareket = hizliHareket;
window.setHarMod = setHarMod;
window.topluHarSatirEkle = topluHarSatirEkle;
window.topluHarDepChange = topluHarDepChange;
window.topluHarKaydet = topluHarKaydet;
window.renderHareketList = renderHareketList;
