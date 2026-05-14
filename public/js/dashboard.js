import { S, DEPO_META } from './state.js';
import { getAllItems, getDepoItems, getStok, durum, depoBadge, esc, escQ, fmt, timeAgo } from './ui-common.js';

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
export function renderDashboard() {
  const tümü = getAllItems();
  let kritikC = 0, normalC = 0;
  const _now2 = new Date(); _now2.setHours(0,0,0,0);
  tümü.forEach(i => {
    const s  = getStok(i.depo, i.ad);
    const mm = S.malzemeMeta[i.depo+'||'+i.ad]||{};
    const isSktKritik = mm.skt && Math.round((new Date(mm.skt)-_now2)/86400000) <= 0;
    if (durum(s.mevcut, s.min, s.max) === 'Kritik' || isSktKritik) kritikC++;
    else normalC++;
  });
  const bugun = S.hareketler.filter(h => new Date(h.tarih).toDateString() === new Date().toDateString()).length;

  document.getElementById('s-toplam').textContent  = tümü.length;
  document.getElementById('s-normal').textContent  = normalC;
  document.getElementById('s-kritik').textContent  = kritikC;
  document.getElementById('s-hareket').textContent = bugun;

  // Trend göstergeleri
  const dun = S.hareketler.filter(h=>{
    const d=new Date(h.tarih); const dn=new Date();
    dn.setDate(dn.getDate()-1);
    return d.toDateString()===dn.toDateString();
  }).length;

  function trendHTML(val, ref, suffix) {
    if(ref===0&&val===0) return '<span class="stat-trend trend-neu">— değişim yok</span>';
    if(val>ref) return '<span class="stat-trend trend-up">↑ '+val+' '+suffix+'</span>';
    if(val<ref) return '<span class="stat-trend trend-down">↓ '+val+' '+suffix+'</span>';
    return '<span class="stat-trend trend-neu">= '+val+' '+suffix+'</span>';
  }

  const nt=document.getElementById('s-normal-trend');
  const kt=document.getElementById('s-kritik-trend');
  const ht=document.getElementById('s-hareket-trend');
  if(nt) nt.innerHTML = tümü.length>0 ? '<span class="stat-trend trend-up" style="font-size:10px">%'+Math.round(normalC/tümü.length*100)+' yeterli</span>' : '';
  if(kt) kt.innerHTML = kritikC>0 ? '<span class="stat-trend trend-down" style="font-size:10px">⚠ '+kritikC+' kritik</span>' : '<span class="stat-trend trend-up" style="font-size:10px">✓ Kritik yok</span>';
  if(ht) ht.innerHTML = trendHTML(bugun, dun, 'işlem');

  // 7-günlük sparkline
  const sparkEl = document.getElementById('dash-sparkline');
  if (sparkEl) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toDateString();
      days.push(S.hareketler.filter(h => new Date(h.tarih).toDateString() === ds).length);
    }
    const maxV = Math.max(...days, 1);
    const W = 72, H = 22, pad = 3;
    const pts = days.map((v, i) => `${pad + i * (W - pad*2) / 6},${H - pad - (v / maxV) * (H - pad*2)}`).join(' ');
    const cx  = pad + 6 * (W - pad*2) / 6;
    const cy  = H - pad - (days[6] / maxV) * (H - pad*2);
    sparkEl.innerHTML = `<svg style="width:100%;max-width:${W}px;display:block" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polyline points="${pts}" style="fill:none;stroke:var(--red);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round;opacity:.45"/>
      <circle cx="${cx}" cy="${cy}" r="2.5" style="fill:var(--red)"/>
    </svg>`;
  }

  // Depo kartları — Düzen C kompakt
  const dc = document.getElementById('depo-cards');
  dc.innerHTML = '';
  for (const [dep, meta] of Object.entries(DEPO_META)) {
    const items = getDepoItems(dep);
    let dk = 0;
    items.forEach(it => { const s = getStok(dep, it.ad); if (durum(s.mevcut,s.min,s.max)==='Kritik') dk++; });
    const cntHtml = dk > 0
      ? `<span style="color:var(--red)">⚠ ${dk} kritik</span>`
      : `<span style="color:var(--green)">✓ ${items.length} kalem</span>`;
    const pctNormal = items.length > 0 ? Math.round((items.length - dk) / items.length * 100) : 100;
    const dotColor  = meta.color || '#aaa';
    dc.innerHTML += `
      <div class="c-depo-card" onclick="goDetay('${escQ(dep)}')">
        <div class="c-depo-dot" style="background:${dotColor}"></div>
        <div class="c-depo-info">
          <div class="c-depo-name" style="color:${dotColor}">${esc(dep)}</div>
          <div class="c-depo-cnt">${cntHtml}</div>
          <div style="height:3px;border-radius:3px;background:${dk>0?'rgba(211,47,47,.2)':'var(--line)'};overflow:hidden;margin-top:6px">
            <div style="height:100%;width:${pctNormal}%;background:${dotColor};border-radius:3px;transition:width .4s"></div>
          </div>
        </div>
        <div class="c-depo-arrow">→</div>
      </div>`;
  }

  // Kritik liste — dashboard
  const dkList = document.getElementById('dash-kritik-list');
  if (dkList) {
    // Stok kritik + SKT yaklaşan malzemeleri birleştir
    const today = new Date(); today.setHours(0,0,0,0);
    const sktUyari = getAllItems().filter(i => {
      const mm = S.malzemeMeta[i.depo+'||'+i.ad]||{};
      if (!mm.skt) return false;
      const diff = Math.round((new Date(mm.skt)-today)/86400000);
      return diff <= S.ayarlar.sktKritikGun;
    });
    const stokKritik = getAllItems().filter(i => {
      const s = getStok(i.depo, i.ad);
      return durum(s.mevcut, s.min, s.max) === 'Kritik';
    });
    // Birleştir ve tekrarları kaldır
    const seen = new Set();
    const kritikItems = [...stokKritik, ...sktUyari].filter(i => {
      const k = i.depo+'||'+i.ad;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, S.ayarlar.dashKritikLimit);
    if (kritikItems.length === 0) {
      dkList.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-lucide="check-circle"></i></div><div class="empty-title">Kritik stok yok</div><div class="empty-desc">Tüm malzemeler yeterli seviyede.</div></div>';
      if (window.lucide) lucide.createIcons({ nodes: [dkList] });
    } else {
      dkList.innerHTML = kritikItems.map(i => {
        const s = getStok(i.depo, i.ad);
        const _mm = S.malzemeMeta[i.depo+'||'+i.ad]||{};
        const _sktD = _mm.skt ? window.sktDurum(_mm.skt) : null;
        const _icon = _sktD ? _sktD.icon : '⚠';
        const _depEsc = escQ(i.depo);
        const _adEsc  = escQ(i.ad);
        return `<div class="dash-kritik-item">
          <div class="dash-warn">${_icon}</div>
          <div style="flex:1;min-width:0">
            <div class="dash-kritik-ad">${esc(i.ad)}${_sktD?'<span class="skt-badge '+_sktD.cls+'" style="margin-left:6px">'+esc(_sktD.label)+'</span>':''}</div>
            <div class="dash-kritik-depo">${esc(i.depo)} · Mevcut: ${s.mevcut} / Min: ${s.min}</div>
          </div>
          <div class="dash-kritik-stok">${s.mevcut}/${s.min}</div>
          <button onclick="event.stopPropagation();hizliHareket('${_depEsc}','${_adEsc}','Giriş')"
            style="margin-left:8px;font-size:12px;padding:4px 9px;background:rgba(102,187,106,.12);border:1px solid rgba(102,187,106,.35);border-radius:6px;cursor:pointer;color:var(--green);font-weight:700;flex-shrink:0"
            title="Hızlı Giriş Kaydı">+ Giriş</button>
        </div>`;
      }).join('') + (getAllItems().filter(i=>{const s=getStok(i.depo,i.ad);return durum(s.mevcut,s.min,s.max)==='Kritik';}).length > 8
        ? `<div style="text-align:center;padding:10px 0;font-size:11px;color:var(--muted)">+ daha fazla kritik stok var →</div>` : '');
    }
  }

  // Son hareketler
  const sh = document.getElementById('son-hareketler');
  sh.innerHTML = S.hareketler.length === 0
    ? '<p style="color:var(--muted);font-size:13px;">Henüz hareket kaydı yok.</p>'
    : S.hareketler.slice(-S.ayarlar.sonHareketLimit).reverse().map(h => `
      <div class="hareket-item">
        <div class="hareket-dot ${h.tur==='Giriş'?'dot-giris':'dot-cikis'}">${h.tur==='Giriş'?'⬆':'⬇'}</div>
        <div class="hareket-info">
          <div class="hareket-mal">${esc(h.malzeme)}</div>
          <div class="hareket-meta">${depoBadge(h.depo)} · <span title="${esc(fmt(new Date(h.tarih)))}">${timeAgo(new Date(h.tarih))}</span>${h.personel?' · '+esc(h.personel):''}</div>
        </div>
        <div class="hareket-miktar ${h.tur==='Giriş'?'giris-clr':'cikis-clr'}">${h.tur==='Giriş'?'+':'−'}${h.miktar}</div>
      </div>`).join('');

  renderChartDepo();
  renderChartDurum('chartDurum');
}

export function renderChartDepo() {
  const labels = Object.keys(DEPO_META);
  const data   = Object.keys(DEPO_META).map(d => getDepoItems(d).length);
  const colors = Object.values(DEPO_META).map(m => m.color);
  if (S.chartDepo) S.chartDepo.destroy();
  S.chartDepo = new Chart(document.getElementById('chartDepo'), {
    type:'bar',
    data:{labels,datasets:[{data,backgroundColor:colors,borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:true,grid:{color:'#dde4ec'}},x:{grid:{display:false}}}}
  });
}

export function renderChartDurum(id) {
  let n=0, k=0, f=0;
  getAllItems().forEach(i => {
    const s = getStok(i.depo, i.ad);
    const d = durum(s.mevcut, s.min, s.max);
    if (d==='Normal') n++; else if (d==='Kritik') k++; else f++;
  });
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const existing = id==='chartDurum' ? S.chartDurum : S.chartDurum2;
  if (existing) existing.destroy();
  const ch = new Chart(canvas, {
    type:'doughnut',
    data:{labels:['Normal','Kritik','Fazla'],
      datasets:[{data:[n,k,f],backgroundColor:['#2e7d32','#d32f2f','#e65100'],borderWidth:0,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{legend:{position:'bottom',labels:{font:{family:'IBM Plex Sans',size:12},padding:12}}}}
  });
  if (id==='chartDurum') S.chartDurum=ch; else S.chartDurum2=ch;
}
