import { S, DEPO_META, API_URL } from './state.js';
import { apiFetch } from './api.js';
import { getAllItems, getDepoItems, getStok, durum, depoBadge, esc, escQ, fmt, timeAgo, dClick } from './ui-common.js';

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
export async function renderDashboard() {
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

  document.getElementById('s-toplam').textContent  = tümü.length;
  document.getElementById('s-normal').textContent  = normalC;
  document.getElementById('s-kritik').textContent  = kritikC;

  // Stok trend göstergeleri (sync)
  const nt=document.getElementById('s-normal-trend');
  const kt=document.getElementById('s-kritik-trend');
  if(nt) nt.innerHTML = tümü.length>0 ? '<span class="stat-trend trend-up">%'+Math.round(normalC/tümü.length*100)+' yeterli</span>' : '';
  if(kt) kt.innerHTML = kritikC>0
    ? '<span class="stat-trend trend-down"><i data-lucide="alert-triangle" class="icon-inline"></i> '+kritikC+' kritik</span>'
    : '<span class="stat-trend trend-up"><i data-lucide="check" class="icon-inline"></i> Kritik yok</span>';

  // Depo kartları — Düzen C kompakt
  const dc = document.getElementById('depo-cards');
  dc.innerHTML = '';
  for (const [dep, meta] of Object.entries(DEPO_META)) {
    const items = getDepoItems(dep);
    let dk = 0;
    items.forEach(it => { const s = getStok(dep, it.ad); if (durum(s.mevcut,s.min,s.max)==='Kritik') dk++; });
    const cntHtml = dk > 0
      ? `<span class="depo-card-status status-danger"><i data-lucide="alert-triangle" class="icon-inline"></i> ${dk} kritik</span>`
      : `<span class="depo-card-status status-ok"><i data-lucide="check" class="icon-inline"></i> ${items.length} kalem</span>`;
    const pctNormal = items.length > 0 ? Math.round((items.length - dk) / items.length * 100) : 100;
    const dotColor  = meta.color || '#aaa';
    dc.innerHTML += `
      <div class="c-depo-card${dk>0?' has-critical':''}" ${dClick('goDetay',dep)} style="--depo-color:${dotColor}">
        <div class="c-depo-info">
          <div class="c-depo-name">${esc(dep)}</div>
          <div class="c-depo-cnt">${cntHtml}</div>
          <div class="c-depo-bar"><div class="c-depo-bar-fill" style="width:${pctNormal}%"></div></div>
        </div>
        <div class="c-depo-arrow"><i data-lucide="chevron-right"></i></div>
      </div>`;
  }

  // Kritik liste — dashboard
  const dkList = document.getElementById('dash-kritik-list');
  if (dkList) {
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
        const _icon = _sktD ? _sktD.icon : 'alert-triangle';
        return `<div class="dash-kritik-item">
          <div class="dash-warn"><i data-lucide="${_icon}"></i></div>
          <div style="flex:1;min-width:0">
            <div class="dash-kritik-ad">${esc(i.ad)}${_sktD?'<span class="skt-badge '+_sktD.cls+'" style="margin-left:6px"><i data-lucide="'+_sktD.icon+'" class="icon-inline"></i> '+esc(_sktD.label)+'</span>':''}</div>
            <div class="dash-kritik-depo">${esc(i.depo)} · Mevcut: ${s.mevcut} / Min: ${s.min}</div>
          </div>
          <div class="dash-kritik-stok">${s.mevcut}/${s.min}</div>
          <button ${dClick('dashHizliGiris',i.depo,i.ad)}
            style="margin-left:8px;font-size:12px;padding:4px 9px;background:rgba(102,187,106,.12);border:1px solid rgba(102,187,106,.35);border-radius:6px;cursor:pointer;color:var(--green);font-weight:700;flex-shrink:0"
            title="Hızlı Giriş Kaydı">+ Giriş</button>
        </div>`;
      }).join('') + (getAllItems().filter(i=>{const s=getStok(i.depo,i.ad);return durum(s.mevcut,s.min,s.max)==='Kritik';}).length > 8
        ? `<div style="text-align:center;padding:10px 0;font-size:11px;color:var(--muted)">+ daha fazla kritik stok var →</div>` : '');
    }
  }

  renderChartDepo();
  renderChartDurum('chartDurum');

  // ── Hareket istatistikleri sunucudan (async) ──────────────────────
  if (!S.API_MOD) {
    document.getElementById('s-hareket').textContent = '—';
    const ht = document.getElementById('s-hareket-trend');
    if (ht) ht.innerHTML = '';
    const sh = document.getElementById('son-hareketler');
    if (sh) sh.innerHTML = '<p style="color:var(--muted);font-size:13px;">Sunucu bağlantısı yok.</p>';
    const sparkEl = document.getElementById('dash-sparkline');
    if (sparkEl) sparkEl.innerHTML = '';
    return;
  }

  try {
    const r = await apiFetch(API_URL + '?action=istatistik');
    if (!r.ok) return;
    const json = await r.json();
    if (!json.ok) return;

    const { ozet, sparkline, sonHareketler } = json;
    const bugun = (ozet.bugunGiris || 0) + (ozet.bugunCikis || 0);
    const dun   = ozet.dunHareket || 0;

    document.getElementById('s-hareket').textContent = bugun;

    const ht = document.getElementById('s-hareket-trend');
    if (ht) {
      if (dun===0 && bugun===0)
        ht.innerHTML = '<span class="stat-trend trend-neu">değişim yok</span>';
      else if (bugun>dun)
        ht.innerHTML = '<span class="stat-trend trend-up"><i data-lucide="trending-up" class="icon-inline"></i> '+bugun+' işlem</span>';
      else if (bugun<dun)
        ht.innerHTML = '<span class="stat-trend trend-down"><i data-lucide="trending-down" class="icon-inline"></i> '+bugun+' işlem</span>';
      else
        ht.innerHTML = '<span class="stat-trend trend-neu">'+bugun+' işlem</span>';
    }

    // 7-günlük sparkline
    const sparkEl = document.getElementById('dash-sparkline');
    if (sparkEl && sparkline?.length === 7) {
      const days = sparkline;
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

    // Son hareketler
    const sh = document.getElementById('son-hareketler');
    if (sh) {
      sh.innerHTML = !sonHareketler?.length
        ? '<p style="color:var(--muted);font-size:13px;">Henüz hareket kaydı yok.</p>'
        : sonHareketler.slice(0, S.ayarlar.sonHareketLimit).map(h => `
          <div class="hareket-item">
            <div class="hareket-dot ${h.tur==='Giriş'?'dot-giris':'dot-cikis'}"><i data-lucide="${h.tur==='Giriş'?'arrow-up':'arrow-down'}"></i></div>
            <div class="hareket-info">
              <div class="hareket-mal">${esc(h.malzeme)}</div>
              <div class="hareket-meta">${depoBadge(h.depo)} · <span title="${esc(fmt(new Date(h.tarih)))}">${timeAgo(new Date(h.tarih))}</span>${h.personel?' · '+esc(h.personel):''}</div>
            </div>
            <div class="hareket-miktar ${h.tur==='Giriş'?'giris-clr':'cikis-clr'}">${h.tur==='Giriş'?'+':'−'}${h.miktar}</div>
          </div>`).join('');
    }
  } catch(e) {
    console.warn('Dashboard hareket istatistik hatası:', e);
  }
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
