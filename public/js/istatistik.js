import { S, API_URL, DEPO_META } from './state.js';
import { getAllItems, getStok, getDepoItems, durum, esc, chartTheme } from './ui-common.js';
import { renderChartDurum } from './dashboard.js';
import { apiFetch } from './api.js';

// ═══════════════════════════════════════════════════════════════════
// İSTATİSTİKLER
// ═══════════════════════════════════════════════════════════════════

export async function renderIstatistik() {
  renderChartDurum('chartDurum2');

  let trend = null, enAktif = null;
  if (S.API_MOD) {
    try {
      const r = await apiFetch(API_URL+'?action=istatistik');
      const j = await r.json();
      if (j.ok) { trend = j.trend; enAktif = j.enAktif; }
    } catch(e) { console.warn('istatistik:', e); }
  }
  if (!trend) {
    trend = [];
    const now = new Date();
    for (let i=5;i>=0;i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const label = d.toLocaleDateString('tr-TR',{month:'short',year:'2-digit'});
      trend.push({ label, giris: 0, cikis: 0 });
    }
  }
  if (!enAktif) {
    enAktif = [];
  }

  const ct = chartTheme();
  if (S.chartTrend) S.chartTrend.destroy();
  S.chartTrend = new Chart(document.getElementById('chartTrend'),{
    type:'line',
    data:{labels:trend.map(t=>t.label),datasets:[
      {label:'Giriş',data:trend.map(t=>t.giris),borderColor:ct.success,backgroundColor:ct.success,tension:.35,fill:false,pointRadius:2,borderWidth:2},
      {label:'Çıkış',data:trend.map(t=>t.cikis),borderColor:ct.danger,backgroundColor:ct.danger,tension:.35,fill:false,pointRadius:2,borderWidth:2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{color:ct.tick,font:{family:ct.font,size:11},boxWidth:10,padding:14,usePointStyle:true}}},
      scales:{
        y:{beginAtZero:true,grid:{color:ct.grid,drawBorder:false},ticks:{color:ct.tick,font:{family:ct.font,size:11},precision:0}},
        x:{grid:{display:false},ticks:{color:ct.tick,font:{family:ct.font,size:11}}}}}
  });

  const depKritik = Object.keys(DEPO_META).map(dep=>
    getDepoItems(dep).filter(item=>{
      const s=getStok(dep,item.ad); return durum(s.mevcut,s.min,s.max)==='Kritik';
    }).length);
  if (S.chartKritikDepo) S.chartKritikDepo.destroy();
  S.chartKritikDepo = new Chart(document.getElementById('chartKritikDepo'),{
    type:'bar',
    data:{labels:Object.keys(DEPO_META),
      datasets:[{label:'Kritik Kalem',data:depKritik,backgroundColor:ct.danger,borderRadius:4,borderSkipped:false,maxBarThickness:48}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        y:{beginAtZero:true,grid:{color:ct.grid,drawBorder:false},ticks:{color:ct.tick,font:{family:ct.font,size:11},precision:0}},
        x:{grid:{display:false},ticks:{color:ct.tick,font:{family:ct.font,size:11}}}}}
  });

  const el=document.getElementById('aktif-malzeme-list');
  el.innerHTML = enAktif.length===0
    ? '<p style="color:var(--muted);font-size:13px;">Henüz hareket kaydı yok.</p>'
    : enAktif.map(({ad,cnt},_,arr)=>`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="flex:1;font-size:13px;font-weight:500">${ad}</div>
        <div class="stok-bar" style="width:140px;height:8px"><div class="stok-bar-fill fill-normal" style="width:${Math.round(cnt/arr[0].cnt*100)}%"></div></div>
        <div class="td-mono" style="min-width:30px;text-align:right">${cnt}</div>
      </div>`).join('');
}

// Expose on window for inline handlers
window.renderIstatistik = renderIstatistik;
