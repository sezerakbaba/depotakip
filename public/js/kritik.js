import { S, DEPO_META } from './state.js';
import { getAllItems, getStok, getDepoItems, durum, durumBadge, depoBadge, esc, escQ, escKey, getKey, dClick } from './ui-common.js';

// ═══════════════════════════════════════════════════════════════════
// KRİTİK STOK & DEPO DETAY
// ═══════════════════════════════════════════════════════════════════

export function renderKritik() {
  let rows='', idx=0;
  getAllItems().forEach(item=>{
    const s=getStok(item.depo,item.ad);
    const d=durum(s.mevcut,s.min,s.max);
    if (d!=='Kritik') return;
    idx++;
    rows+=`<tr>
      <td class="td-mono" style="color:var(--muted)">${idx}</td>
      <td class="td-name">${item.ad}${S.malzemeMeta[getKey(item.depo,item.ad)]?.skt?'<br>'+window.sktBadge(S.malzemeMeta[getKey(item.depo,item.ad)].skt):''}</td>
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
  const _sktItems = getAllItems().filter(i => i.depo==='Kimyasal Deposu' && (S.malzemeMeta[getKey(i.depo,i.ad)]||{}).skt);
  _sktItems.forEach(i => {
    const mm = S.malzemeMeta[getKey(i.depo,i.ad)]||{};
    const diff = Math.round((new Date(mm.skt) - _today)/86400000);
    if (diff < 0) _gecmis++;
    else if (diff <= S.ayarlar.sktKritikGun) _90g++;
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
      const diff = Math.round((new Date((S.malzemeMeta[getKey(i.depo,i.ad)]||{}).skt) - _today)/86400000);
      return diff <= S.ayarlar.sktKritikGun;
    }).sort((a,b) => new Date((S.malzemeMeta[getKey(a.depo,a.ad)]||{}).skt) - new Date((S.malzemeMeta[getKey(b.depo,b.ad)]||{}).skt));
    _sktListe.innerHTML = _urgent.length ? _urgent.map(i => {
      const mm = S.malzemeMeta[getKey(i.depo,i.ad)]||{};
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
        <div style="flex:1;font-size:13px">${i.ad}</div>
        <div>${window.sktBadge(mm.skt)}</div>
      </div>`;
    }).join('') : '<p style="font-size:13px;color:var(--muted);text-align:center;padding:12px">Son 90 gün içinde biten kimyasal yok.</p>';
  }
  document.getElementById('kritik-tbody').innerHTML = rows ||
    '<tr><td colspan="7" style="padding:0"><div class="empty-state"><div class="empty-icon"><i data-lucide="check-circle"></i></div><div class="empty-title">Kritik stok yok</div><div class="empty-desc">Tüm malzemeler yeterli seviyede.</div></div></td></tr>';
  if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('kritik-tbody')] });

  const btn = document.getElementById('kritik-talep-btn');
  if (btn) btn.style.display = idx>0 ? '' : 'none';
}

export function kritikTalepAktar() {
  const kritikler = [];
  getAllItems().forEach(item=>{
    const s=getStok(item.depo,item.ad);
    if (durum(s.mevcut,s.min,s.max)==='Kritik')
      kritikler.push({ad:item.ad, depo:item.depo, mevcut:s.mevcut, min:s.min});
  });
  if (kritikler.length===0) { window.toast('Kritik stok yok.','error'); return; }
  S._pendingKritikler = kritikler;
  S.talepSatirCount = 0;
  document.getElementById('talep-tbody').innerHTML = '';
  window.navigate('talep');
}

export function goDetay(dep) {
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
      <td class="td-name">${esc(item.ad)}${S.malzemeMeta[getKey(dep,item.ad)]?.skt?'<br>'+window.sktBadge(S.malzemeMeta[getKey(dep,item.ad)].skt):''}</td>
      <td class="td-mono" style="font-weight:700;color:${d==='Kritik'?'var(--red)':d==='Fazla'?'var(--amber)':'var(--blue)'}">${s.mevcut}</td>
      <td class="td-mono" style="color:var(--muted)">${esc((S.malzemeMeta[getKey(dep,item.ad)]||{}).birim||'—')}</td>
      <td class="td-mono">${s.min}</td>
      <td class="td-mono">${s.max}</td>
      <td><div class="stok-bar-wrap"><div class="stok-bar"><div class="stok-bar-fill ${fillCls}" style="width:${pct}%"></div></div><span class="stok-num">${pct}%</span></div></td>
      <td>${durumBadge(d)}</td>
      <td><button class="btn btn-sm btn-outline" ${dClick('openStokModal',key,dep,item.ad)}>✎</button></td>
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

  S.aktifSayfa='depo-detay';
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-depo-detay').classList.add('active');
}

// Expose on window for inline handlers
window.renderKritik = renderKritik;
window.kritikTalepAktar = kritikTalepAktar;
window.goDetay = goDetay;
