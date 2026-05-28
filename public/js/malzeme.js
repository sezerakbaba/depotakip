import { S } from './state.js';
import { getAllItems, getStok, getDepoItems, durum, durumBadge, depoBadge, esc, escQ, escKey, getKey, dClick } from './ui-common.js';

// ═══════════════════════════════════════════════════════════════════
// MALZEME EKLE / SİL
// ═══════════════════════════════════════════════════════════════════

export function toggleYeniSKT(dep) {
  const wrap = document.getElementById('yeni-skt-wrap');
  if (wrap) wrap.style.display = (dep === 'Kimyasal Deposu') ? 'block' : 'none';
}

export function malzemeEkle() {
  const dep    = document.getElementById('yeni-depo').value;
  const ad     = document.getElementById('yeni-ad').value.trim();
  const birim    = window.getDigerVal('yeni-birim','yeni-birim-diger');
  const kategori  = window.getDigerVal('yeni-kategori','yeni-kategori-diger');
  const marka     = (document.getElementById('yeni-marka')?.value||'').trim();
  const mevcut = parseInt(document.getElementById('yeni-mevcut').value)||0;
  const min    = parseInt(document.getElementById('yeni-min').value)||0;
  const max    = parseInt(document.getElementById('yeni-max').value)||0;

  if (!dep)  { window.toast('Depo seçin!','error'); return; }
  if (!ad)   { window.toast('Malzeme adı girin!','error'); return; }
  if (!kategori && S.ayarlar.katZorunlu) { window.toast('Kategori seçimi zorunlu!','error'); return; }

  const mevcut_items = getDepoItems(dep);
  if (mevcut_items.find(i=>i.ad.toLowerCase()===ad.toLowerCase())) {
    window.toast('Bu isimde malzeme zaten mevcut!','error'); return;
  }

  const k = getKey(dep, ad);
  S.ozelMalzeme[k]={ad, sayim: (mevcut ? String(mevcut) : '0') + (birim ? ' ' + birim : ''), depo:dep, birim, kategori, marka};
  S.malzemeMeta[k]={birim, kategori, marka};
  const _nskt = document.getElementById('yeni-skt');
  if (_nskt && _nskt.value) S.malzemeMeta[k].skt = _nskt.value;
  S.stok[k] = {mevcut, min, max};

  ['yeni-depo','yeni-ad','yeni-birim','yeni-kategori','yeni-marka','yeni-birim-diger','yeni-kategori-diger','yeni-skt'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['yeni-birim-diger-wrap','yeni-kategori-diger-wrap'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  ['yeni-mevcut','yeni-min','yeni-max'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=id==='yeni-mevcut'?'0':id==='yeni-min'?'1':'10'; });

  renderMalzemeEkleList();
  window.refreshAll();
  window.toast(`"${ad}" eklendi ✓`);
}

export function malzemeSil(dep, ad) {
  if (!confirm(`"${ad}" malzemesini silmek istediğinizden emin misiniz?`)) return;
  const k = getKey(dep, ad);
  if (S.ozelMalzeme[k]) {
    delete S.ozelMalzeme[k];
    delete S.stok[k];
  } else {
    S.silinmis[k] = true;
  }
  renderMalzemeEkleList();
  window.refreshAll();
  window.toast(`"${ad}" silindi.`);
}

export function renderMalzemeEkleList() {
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
    const mm  = S.malzemeMeta[getKey(item.depo,item.ad)]||{};
    const key = escKey(item.depo, item.ad);
    const sktHtml = mm.skt ? '<br>'+window.sktBadge(mm.skt) : '';
    const ozelStar = item.ozel ? '<i data-lucide="star" class="icon-inline ozel-star" title="Özel ekleme"></i>' : '';
    const birimTxt = mm.birim || item.birim || '—';
    const katHtml  = item.kategori ? window.katBadgeHTML(item.kategori) : '<span style="color:var(--muted)">—</span>';
    rows += `<tr>
      <td class="td-name">${esc(item.ad)}${ozelStar}${sktHtml}</td>
      <td>${depoBadge(item.depo)}</td>
      <td class="td-mono" style="font-size:11px">${esc(birimTxt)}</td>
      <td>${katHtml}</td>
      <td class="td-mono" style="font-weight:700;color:${d==='Kritik'?'var(--red)':d==='Fazla'?'var(--amber)':'var(--blue)'}">${s.mevcut}</td>
      <td>${durumBadge(d)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-outline" ${dClick('openStokModal',key,item.depo,item.ad)} style="margin-right:4px" title="Düzenle"><i data-lucide="pencil"></i></button>
        <button class="btn btn-sm btn-danger-soft btn-icon" ${dClick('malzemeSil',item.depo,item.ad)} title="Sil"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = rows || `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">Malzeme bulunamadı.</td></tr>`;
}

// Expose on window for inline handlers
window.toggleYeniSKT = toggleYeniSKT;
window.malzemeEkle = malzemeEkle;
window.malzemeSil = malzemeSil;
window.renderMalzemeEkleList = renderMalzemeEkleList;
