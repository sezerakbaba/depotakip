import { S, STOK_SUTUNLAR, KAT_COLORS, KAYNAK } from './state.js';
import { getAllItems, getStok, durum, durumBadge, depoBadge, esc, escKey, escQ, getKey } from './ui-common.js';

// ═══════════════════════════════════════════════════════════════════
// STOK LİSTESİ
// ═══════════════════════════════════════════════════════════════════

export function katBadgeHTML(kat){
  const cc=KAT_COLORS[kat]||{c:'#546e7a',bg:'#eceff1'};
  return '<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600;background:'+cc.bg+';color:'+cc.c+'">'+esc(kat)+'</span>';
}
export function setKatFilter(el,val){
  document.querySelectorAll('.filter-chip[data-kat]').forEach(c=>c.classList.remove('active'));
  if(el&&el.classList)el.classList.add('active');
  S.stokKatFilter=val;S.stokSayfa=0;
  const sel=document.getElementById('stok-kat-select');
  if(sel)sel.value=val;
  renderStok();
}
export function setKatFilterSel(val){
  S.stokKatFilter=val;S.stokSayfa=0;
  renderStok();
}
export function setDurumFilter(el, val) {
  const was = el.classList.contains('active');
  document.querySelectorAll('.filter-chip[data-durum]').forEach(c=>c.classList.remove('active'));
  S.stokDurumFilter = was ? '' : val;
  if (!was) el.classList.add('active');
  S.stokSayfa=0;
  renderStok();
}

export function setDepoFilter(el, val, color) {
  document.querySelectorAll('.filter-chip[data-depo]').forEach(c => {
    c.classList.remove('active');
    c.style.borderColor = '';
    c.style.background  = '';
    c.style.color       = '';
  });
  el.classList.add('active');
  if (color && val !== 'Tümü') {
    el.style.borderColor = color;
    el.style.background  = color;
    el.style.color       = '#fff';
  }
  S.stokDepoFilter=val;S.stokSayfa=0;
  renderStok();
}

export function resetStokSort() {
  S.stokSortKey = null;
  S.stokSortDir = 1;
  ['ad','depo','kategori','mevcut','min','max','durum'].forEach(k => {
    const el = document.getElementById('sort-'+k);
    if (el) el.textContent = '';
  });
}

export function stokSort(key) {
  if (S.stokSortKey === key) S.stokSortDir = -S.stokSortDir;
  else { S.stokSortKey = key; S.stokSortDir = 1; }
  renderStok();
}

export function stokSutunlariGetir() {
  const sirasi = (S.ayarlar.stokSutunSirasi && S.ayarlar.stokSutunSirasi.length)
    ? S.ayarlar.stokSutunSirasi
    : STOK_SUTUNLAR.map(s => s.key);
  const gizli = S.ayarlar.stokSutunGizli || [];
  // Sort by saved order, include any new keys at end
  const sorted = [];
  sirasi.forEach(k => { if (STOK_SUTUNLAR.find(s => s.key === k)) sorted.push(k); });
  STOK_SUTUNLAR.forEach(s => { if (!sorted.includes(s.key)) sorted.push(s.key); });
  return sorted.map(k => STOK_SUTUNLAR.find(s => s.key === k)).filter(s => s && !gizli.includes(s.key));
}

export function renderStok(){
  const q=(document.getElementById('stok-search')?.value||'').toLowerCase();
  const tbl=document.getElementById('stok-tbody');

  let items = getAllItems().filter(item=>{
    if(S.stokDepoFilter!=='Tümü'&&item.depo!==S.stokDepoFilter) return false;
    if(S.stokKatFilter!=='Tümü'&&item.kategori!==S.stokKatFilter) return false;
    if(q&&!item.ad.toLowerCase().includes(q)&&!(item.kategori||'').toLowerCase().includes(q)) return false;
    const s=getStok(item.depo,item.ad);
    const d=durum(s.mevcut,s.min,s.max);
    if(S.stokDurumFilter&&d!==S.stokDurumFilter) return false;
    return true;
  });

  if (S.stokSortKey) {
    items.sort((a,b) => {
      let va, vb;
      const sa=getStok(a.depo,a.ad), sb=getStok(b.depo,b.ad);
      if (S.stokSortKey==='mevcut') { va=sa.mevcut; vb=sb.mevcut; }
      else if (S.stokSortKey==='min') { va=sa.min; vb=sb.min; }
      else if (S.stokSortKey==='max') { va=sa.max; vb=sb.max; }
      else if (S.stokSortKey==='durum') {
        const ord={Kritik:0,Normal:1,Fazla:2};
        va=ord[durum(sa.mevcut,sa.min,sa.max)];
        vb=ord[durum(sb.mevcut,sb.min,sb.max)];
      } else {
        va=(a[S.stokSortKey]||'').toLowerCase();
        vb=(b[S.stokSortKey]||'').toLowerCase();
      }
      return va<vb ? -S.stokSortDir : va>vb ? S.stokSortDir : 0;
    });
  }

  // ── KPI ──────────────────────────────────────────────────────────────────
  const tumItems = getAllItems().filter(item=>{
    if(S.stokDepoFilter!=='Tümü'&&item.depo!==S.stokDepoFilter) return false;
    if(S.stokKatFilter!=='Tümü'&&item.kategori!==S.stokKatFilter) return false;
    if(q&&!item.ad.toLowerCase().includes(q)&&!(item.kategori||'').toLowerCase().includes(q)) return false;
    return true;
  });
  let kpiToplam=0, kpiKritik=0, kpiNormal=0, kpiFazla=0;
  tumItems.forEach(item=>{
    const s=getStok(item.depo,item.ad); const d=durum(s.mevcut,s.min,s.max);
    kpiToplam++; if(d==='Kritik')kpiKritik++; else if(d==='Fazla')kpiFazla++; else kpiNormal++;
  });
  const kpiEl = document.getElementById('stok-kpi');
  if (kpiEl) {
    const kpiAktif = (cls) => S.stokDurumFilter===cls?' kpi-aktif':'';
    kpiEl.innerHTML = `
      <div class="kpi-kart" onclick="S.stokDurumFilter='';S.stokSayfa=0;renderStok()">
        <div class="kpi-sayi">${kpiToplam}</div><div class="kpi-lbl">Toplam</div>
      </div>
      <div class="kpi-kart kpi-kritik${kpiAktif('Kritik')}" onclick="S.stokDurumFilter=S.stokDurumFilter==='Kritik'?'':'Kritik';S.stokSayfa=0;renderStok()">
        <div class="kpi-sayi">${kpiKritik}</div><div class="kpi-lbl"><i data-lucide="alert-triangle" class="icon-inline"></i> Kritik</div>
      </div>
      <div class="kpi-kart kpi-normal${kpiAktif('Normal')}" onclick="S.stokDurumFilter=S.stokDurumFilter==='Normal'?'':'Normal';S.stokSayfa=0;renderStok()">
        <div class="kpi-sayi">${kpiNormal}</div><div class="kpi-lbl"><i data-lucide="check-circle" class="icon-inline"></i> Normal</div>
      </div>
      <div class="kpi-kart kpi-fazla${kpiAktif('Fazla')}" onclick="S.stokDurumFilter=S.stokDurumFilter==='Fazla'?'':'Fazla';S.stokSayfa=0;renderStok()">
        <div class="kpi-sayi">${kpiFazla}</div><div class="kpi-lbl"><i data-lucide="trending-up" class="icon-inline"></i> Fazla</div>
      </div>`;
    if (window.lucide) lucide.createIcons({ nodes: [kpiEl] });
  }

  // ── Aktif filtreler ───────────────────────────────────────────────────────
  const afEl = document.getElementById('stok-aktif-filtreler');
  if (afEl) {
    const chips = [];
    if (S.stokDepoFilter !== 'Tümü') chips.push(`<span class="af-chip">Depo: <strong>${esc(S.stokDepoFilter)}</strong><button onclick="S.stokDepoFilter='Tümü';document.querySelectorAll('.filter-chip[data-depo]').forEach(c=>{c.classList.remove('active');c.style.cssText=''});document.querySelector('.filter-chip[data-depo=\\'Tümü\\']')?.classList.add('active');S.stokSayfa=0;renderStok()">×</button></span>`);
    if (S.stokKatFilter !== 'Tümü') chips.push(`<span class="af-chip">Kategori: <strong>${esc(S.stokKatFilter)}</strong><button onclick="S.stokKatFilter='Tümü';const sel=document.getElementById('stok-kat-select');if(sel)sel.value='Tümü';S.stokSayfa=0;renderStok()">×</button></span>`);
    if (S.stokDurumFilter) chips.push(`<span class="af-chip">Durum: <strong>${esc(S.stokDurumFilter)}</strong><button onclick="S.stokDurumFilter='';S.stokSayfa=0;renderStok()">×</button></span>`);
    if (q) chips.push(`<span class="af-chip">Arama: <strong>${esc(q)}</strong><button onclick="const si=document.getElementById('stok-search');if(si){si.value='';document.getElementById('stok-search-clear').style.display='none';}S.stokSayfa=0;renderStok()">×</button></span>`);
    if (chips.length > 0) {
      afEl.innerHTML = chips.join('') + `<button class="af-temizle" onclick="S.stokDepoFilter='Tümü';S.stokKatFilter='Tümü';S.stokDurumFilter='';const si=document.getElementById('stok-search');if(si){si.value='';document.getElementById('stok-search-clear').style.display='none';}document.querySelectorAll('.filter-chip').forEach(c=>{c.classList.remove('active');c.style.cssText=''});document.querySelector('.filter-chip[data-depo=\\'Tümü\\']')?.classList.add('active');const sel=document.getElementById('stok-kat-select');if(sel)sel.value='Tümü';S.stokSayfa=0;renderStok()"><i data-lucide='x' class='icon-inline'></i> Tümünü Temizle</button>`;
      afEl.style.display = 'flex';
      if (window.lucide) lucide.createIcons({ nodes: [afEl] });
    } else {
      afEl.style.display = 'none';
    }
  }

  // Sayfalama hesapla
  const toplamKalem = items.length;
  const toplamSayfa = Math.max(1, Math.ceil(toplamKalem / S.ayarlar.stokSayfaBoy));
  if (S.stokSayfa >= toplamSayfa) S.stokSayfa = toplamSayfa - 1;
  const baslangic = S.stokSayfa * S.ayarlar.stokSayfaBoy;
  const sayfa_items = items.slice(baslangic, baslangic + S.ayarlar.stokSayfaBoy);

  const gorunenSutunlar = stokSutunlariGetir();
  const colCount = gorunenSutunlar.length + 2; // # + dinamik + İşlem

  // Rebuild thead dynamically
  const thead = document.querySelector('#stok-table thead tr');
  if (thead) {
    // ── Sıralama ikonları: aktif sütunda chevron, diğerlerinde soluk çift ok ──
    const sortIconFor = (sortKey) => {
      if (S.stokSortKey === sortKey) {
        return S.stokSortDir === 1
          ? ' <i data-lucide="chevron-up" class="sort-icon sort-icon-aktif"></i>'
          : ' <i data-lucide="chevron-down" class="sort-icon sort-icon-aktif"></i>';
      }
      return ' <i data-lucide="chevrons-up-down" class="sort-icon sort-icon-pasif"></i>';
    };
    thead.innerHTML = '<th>#</th>'
      + gorunenSutunlar.map(col => {
          const isSortable = ['malzeme','depo','kategori','mevcut','min','max','durum'].includes(col.key);
          const sortKey = col.key === 'malzeme' ? 'ad' : col.key;
          if (isSortable) {
            return `<th class="sortable stok-th-drag" draggable="true" data-col="${col.key}" onclick="stokSort('${sortKey}')">${col.label}${sortIconFor(sortKey)}</th>`;
          }
          return `<th class="stok-th-drag" draggable="true" data-col="${col.key}">${col.label}</th>`;
        }).join('')
      + '<th data-col="islem">İşlem</th>';
    if (window.lucide) lucide.createIcons({ nodes: [thead] });
  }

  // Arama vurgulama yardımcısı
  const vurgula = (txt) => {
    if (!q) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if (idx === -1) return esc(txt);
    return esc(txt.slice(0, idx)) + '<mark class="stok-vurgu">' + esc(txt.slice(idx, idx + q.length)) + '</mark>' + esc(txt.slice(idx + q.length));
  };

  let rows='';
  sayfa_items.forEach((item, i)=>{
    const s=getStok(item.depo,item.ad);
    const d=durum(s.mevcut,s.min,s.max);
    const idx = baslangic + i + 1;
    const pct=s.max>0?Math.min(100,Math.round((s.mevcut/s.max)*100)):0;
    const minPct=s.max>0?Math.min(100,Math.round((s.min/s.max)*100)):0;
    const fc=d==='Kritik'?'fill-kritik':d==='Fazla'?'fill-fazla':'fill-normal';
    const key=escKey(item.depo,item.ad);
    const katCell=item.kategori?katBadgeHTML(item.kategori):'<span style="font-size:11px;color:var(--muted)">—</span>';
    const birCell=item.birim?esc(item.birim):'<span style="color:var(--muted)">—</span>';
    const rowCls = d==='Kritik' ? 'row-kritik' : d==='Fazla' ? 'row-fazla' : '';
    const _mh2=S.hareketler.filter(h=>h.depo===item.depo&&h.malzeme===item.ad);

    let dynamicCells = '';
    gorunenSutunlar.forEach(col => {
      switch(col.key) {
        case 'depo':
          dynamicCells += '<td data-col="depo" data-label="Depo">'+depoBadge(item.depo)+'</td>';
          break;
        case 'malzeme': {
          const meta = S.malzemeMeta[getKey(item.depo,item.ad)]||{};
          dynamicCells += '<td class="td-name" data-col="malzeme" data-label="Malzeme">'
            +'<div>'+vurgula(item.ad)+(item.ozel?'<span style="font-size:10px;color:var(--teal);margin-left:6px">★</span>':'')+'</div>'
            +(meta.marka?'<div><span class="marka-badge">'+esc(meta.marka)+'</span></div>':'')
            +(meta.skt?'<div>'+window.sktBadge(meta.skt)+'</div>':'')
            +'</td>';
          break;
        }
        case 'kategori':
          dynamicCells += '<td data-col="kategori" data-label="Kategori">'+katCell+'</td>';
          break;
        case 'mevcut':
          dynamicCells += '<td class="td-mono" data-col="mevcut" data-label="Mevcut" style="font-weight:700;color:'+(d==='Kritik'?'var(--red)':d==='Fazla'?'var(--amber)':'var(--blue)')+'">'+s.mevcut+'</td>';
          break;
        case 'birim':
          dynamicCells += '<td class="td-mono" data-col="birim" data-label="Birim" style="color:var(--muted)">'+birCell+'</td>';
          break;
        case 'min':
          dynamicCells += '<td class="td-mono" data-col="min" data-label="Min">'+s.min+'</td>';
          break;
        case 'max':
          dynamicCells += '<td class="td-mono" data-col="max" data-label="Max">'+s.max+'</td>';
          break;
        case 'durum':
          dynamicCells += '<td data-col="durum" data-label="Durum">'+durumBadge(d)+'</td>';
          break;
        case 'doluluk': {
          const tickHtml = (s.max>0 && s.min>0)
            ? `<div class="stok-bar-tick" style="left:${minPct}%" title="Min: ${s.min}"></div>`
            : '';
          dynamicCells += `<td data-col="doluluk" data-label="Doluluk"><div class="stok-bar-wrap"><div class="stok-bar"><div class="stok-bar-fill ${fc}" style="width:${pct}%"></div>${tickHtml}</div><span class="stok-num">${pct}%</span></div></td>`;
          break;
        }
      }
    });

    const _depQ = escQ(item.depo);
    const _adQ  = escQ(item.ad);
    const logBtn = _mh2.length>0
      ? `<button class="islem-btn islem-btn-log" onclick="openMalHareket('${_depQ}','${_adQ}')" title="Hareket geçmişi (${_mh2.length})"><i data-lucide="history"></i><span class="islem-badge">${_mh2.length}</span></button>`
      : '';
    rows+='<tr class="'+rowCls+'">'
      +'<td class="td-mono" data-label="#">'+idx+'</td>'
      +dynamicCells
      +`<td data-col="islem" data-label="İşlem"><div class="islem-grup">`
      +logBtn
      +`<button class="islem-btn islem-btn-in" onclick="hizliHareket('${_depQ}','${_adQ}','Giriş')" title="Hızlı Giriş"><i data-lucide="plus-circle"></i></button>`
      +`<button class="islem-btn islem-btn-out" onclick="hizliHareket('${_depQ}','${_adQ}','Çıkış')" title="Hızlı Çıkış"><i data-lucide="minus-circle"></i></button>`
      +`<button class="islem-btn islem-btn-edit" onclick="openStokModal('${key}','${_depQ}','${_adQ}')" title="Düzenle"><i data-lucide="pencil"></i></button>`
      +`</div></td>`
      +'</tr>';
  });

  const emptyState = `<tr><td colspan="${colCount}" style="padding:0">
    <div class="empty-state">
      <div class="empty-icon"><i data-lucide="search-x"></i></div>
      <div class="empty-title">Sonuç bulunamadı</div>
      <div class="empty-desc">Arama veya filtre kriterlerinizi değiştirin.</div>
      <button class="btn btn-outline btn-sm" style="margin-top:12px" onclick="S.stokDepoFilter='Tümü';S.stokKatFilter='Tümü';S.stokDurumFilter='';const si=document.getElementById('stok-search');if(si){si.value='';document.getElementById('stok-search-clear').style.display='none';}S.stokSayfa=0;renderStok()"><i data-lucide='x' class='icon-inline'></i> Filtreleri Temizle</button>
    </div>
  </td></tr>`;
  tbl.innerHTML = rows || emptyState;
  if (window.lucide) lucide.createIcons({ nodes: [tbl] });

  // Sayfalama kontrolleri
  const spEl = document.getElementById('stok-sayfalama');
  if (spEl) {
    if (toplamSayfa <= 1) { spEl.innerHTML = `<span style="font-size:11px;color:var(--muted)">${toplamKalem} kalem</span>`; }
    else {
      const goster = 2; // aktif sayfanın her iki yanında gösterilecek sayfa sayısı
      let btns = `<span style="font-size:11px;color:var(--muted)">${toplamKalem} kalem</span>`;
      btns += `<div style="display:flex;gap:4px;align-items:center">`;
      btns += `<button class="sayfa-btn" onclick="S.stokSayfa--;renderStok()" ${S.stokSayfa===0?'disabled':''}>‹</button>`;
      for (let p = 0; p < toplamSayfa; p++) {
        if (p === 0 || p === toplamSayfa-1 || Math.abs(p - S.stokSayfa) <= goster) {
          btns += `<button class="sayfa-btn ${p===S.stokSayfa?'aktif':''}" onclick="S.stokSayfa=${p};renderStok()">${p+1}</button>`;
        } else if (Math.abs(p - S.stokSayfa) === goster+1) {
          btns += `<span style="color:var(--muted);font-size:12px;padding:0 2px">…</span>`;
        }
      }
      btns += `<button class="sayfa-btn" onclick="S.stokSayfa++;renderStok()" ${S.stokSayfa===toplamSayfa-1?'disabled':''}>›</button>`;
      btns += `</div>`;
      spEl.innerHTML = btns;
    }
  }

  _updateStokTableHeight();
  initStokSutunDrag();
  renderStokSutunMenu();
}

export function _updateStokTableHeight() {
  requestAnimationFrame(() => {
    const wrapper = document.querySelector('#page-stok .table-wrapper');
    const toolbar = document.querySelector('.stok-toolbar-sticky');
    const pagination = document.getElementById('stok-sayfalama');
    if (!wrapper || !toolbar) return;
    const topbar = 52;
    const toolbarH = toolbar.offsetHeight;
    const paginationH = pagination ? pagination.offsetHeight : 50;
    const contentPadding = 40;
    wrapper.style.maxHeight = (window.innerHeight - topbar - toolbarH - paginationH - contentPadding) + 'px';
  });
}
// Pencere boyutu değişince yüksekliği güncelle
window.addEventListener('resize', _updateStokTableHeight);

export function initStokSutunDrag() {
  const thead = document.querySelector('#stok-table thead');
  if (!thead || thead._dragInited) return;
  thead._dragInited = true;

  let dragSrc = null;

  thead.addEventListener('dragstart', e => {
    const th = e.target.closest('.stok-th-drag');
    if (!th) return;
    dragSrc = th;
    th.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  thead.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('dragging');
    thead.querySelectorAll('.stok-th-drag').forEach(t => t.classList.remove('drag-over'));
    dragSrc = null;
  });
  thead.addEventListener('dragover', e => {
    e.preventDefault();
    const th = e.target.closest('.stok-th-drag');
    thead.querySelectorAll('.stok-th-drag').forEach(t => t.classList.remove('drag-over'));
    if (th && th !== dragSrc) th.classList.add('drag-over');
  });
  thead.addEventListener('drop', e => {
    e.preventDefault();
    const th = e.target.closest('.stok-th-drag');
    if (!dragSrc || !th || dragSrc === th) return;
    const srcKey = dragSrc.dataset.col;
    const dstKey = th.dataset.col;
    const sirasi = (S.ayarlar.stokSutunSirasi && S.ayarlar.stokSutunSirasi.length)
      ? [...S.ayarlar.stokSutunSirasi]
      : STOK_SUTUNLAR.map(s => s.key);
    const si = sirasi.indexOf(srcKey);
    const di = sirasi.indexOf(dstKey);
    if (si !== -1 && di !== -1) {
      sirasi.splice(si, 1);
      sirasi.splice(di, 0, srcKey);
      S.ayarlar.stokSutunSirasi = sirasi;
      window.ayarlariKaydet();
      renderStok();
    }
  });
}

export function renderStokSutunMenu() {
  const btn = document.getElementById('stok-sutun-btn');
  if (!btn) return;
  const menu = document.getElementById('stok-sutun-menu');
  if (!menu) return;
  const gizli = S.ayarlar.stokSutunGizli || [];
  menu.innerHTML = STOK_SUTUNLAR.map(s => `
    <label class="sutun-menu-item">
      <input type="checkbox" ${gizli.includes(s.key) ? '' : 'checked'}
        onchange="toggleStokSutun('${s.key}',this.checked)">
      ${s.label}
    </label>
  `).join('');
}

export function toggleStokSutun(key, visible) {
  let gizli = [...(S.ayarlar.stokSutunGizli || [])];
  if (visible) gizli = gizli.filter(k => k !== key);
  else if (!gizli.includes(key)) gizli.push(key);
  S.ayarlar.stokSutunGizli = gizli;
  window.ayarlariKaydet();
  renderStok();
}

export function openStokModal(_key, dep, mal) {
  S.editKey = {dep, mal};
  const s = getStok(dep, mal);
  const mm=S.malzemeMeta[getKey(dep,mal)]||{};
  const _birList=[...S.ayarlar.birimler,'Diğer'];
  const _bo=_birList.map(b=>'<option value="'+b+'"'+(mm.birim===b||(!_birList.includes(mm.birim)&&mm.birim&&b==='Diğer')?' selected':'')+'>'+b+'</option>').join('');
  const _birDiğerVal = (_birList.includes(mm.birim)||!mm.birim) ? '' : mm.birim;
  const _katList=Object.keys(KAT_COLORS);
  const _ko=_katList.map(k=>'<option value="'+k+'"'+(mm.kategori===k||(!_katList.includes(mm.kategori)&&mm.kategori&&k==='Diğer')?' selected':'')+'>'+k+'</option>').join('');
  const _katDiğerVal = (_katList.includes(mm.kategori)||!mm.kategori) ? '' : mm.kategori;
  document.getElementById('modal-stok-icerik').innerHTML=
    '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">'+dep+'</p>'
    +'<div class="form-grid">'
    +'<div class="form-group" style="grid-column:1/-1">'
    +'<label>Malzeme Adı</label>'
    +'<input type="text" id="m-ad" value="'+mal.replace(/"/g,'&quot;')+'" style="font-weight:600">'
    +'<input type="text" id="m-marka" value="'+(mm.marka||'').replace(/"/g,'&quot;')+'" placeholder="Marka (opsiyonel)" style="margin-top:5px;font-size:11px;color:var(--muted);border-color:var(--line)">'
    +'</div>'
    +'<div class="form-group"><label>Mevcut Stok</label><input type="number" id="m-mevcut" value="'+s.mevcut+'" min="0"></div>'
    +'<div class="form-group"><label>Min Stok</label><input type="number" id="m-min" value="'+s.min+'" min="0"></div>'
    +'<div class="form-group"><label>Max Stok</label><input type="number" id="m-max" value="'+s.max+'" min="0"></div>'
    +'<div class="form-group"><label>Birim</label>'
    +'<select id="m-birim" onchange="handleDiger(this,\'m-birim-diger\')"><option value="">— Seçin —</option>'+_bo+'</select>'
    +'<div id="m-birim-diger-wrap" style="display:'+(_birDiğerVal?'block':'none')+';margin-top:5px">'
    +'<input type="text" id="m-birim-diger" value="'+_birDiğerVal+'" placeholder="Birim girin..." style="font-size:12px"></div></div>'
    +'<div class="form-group"><label>Kategori</label>'
    +'<select id="m-kategori" onchange="handleDiger(this,\'m-kategori-diger\')"><option value="">— Seçin —</option>'+_ko+'</select>'
    +'<div id="m-kategori-diger-wrap" style="display:'+(_katDiğerVal?'block':'none')+';margin-top:5px">'
    +'<input type="text" id="m-kategori-diger" value="'+_katDiğerVal+'" placeholder="Kategori girin..." style="font-size:12px"></div></div>'
    +(dep==='Kimyasal Deposu'?'<div class="form-group" style="grid-column:1/-1"><label>☠ Son Kullanma Tarihi</label><input type="date" id="m-skt" value="'+(mm.skt||'')+'" style="font-family:IBM Plex Mono,monospace"></div>':'')
    +'</div>';
  document.getElementById('modal-stok').classList.add('open');
}

export function saveStok() {
  if (!S.editKey) return;
  const yeniAd = (document.getElementById('m-ad')?.value||'').trim();
  const mevcut = parseInt(document.getElementById('m-mevcut').value)||0;
  const min    = parseInt(document.getElementById('m-min').value)||0;
  const max    = parseInt(document.getElementById('m-max').value)||0;
  if (!yeniAd) { window.toast('Malzeme adı boş olamaz!','error'); return; }
  const eskiAd = S.editKey.mal;
  const dep    = S.editKey.dep;
  const eskiKey= getKey(dep, eskiAd);
  const yeniKey= getKey(dep, yeniAd);
  // Stok verisini taşı
  S.stok[yeniKey]={mevcut,min,max};
  if (yeniKey!==eskiKey) { delete S.stok[eskiKey]; }
  // Meta verisini taşı
  if(!S.malzemeMeta[yeniKey])S.malzemeMeta[yeniKey]={};
  S.malzemeMeta[yeniKey].birim    = window.getDigerVal('m-birim','m-birim-diger');
  S.malzemeMeta[yeniKey].kategori = window.getDigerVal('m-kategori','m-kategori-diger');
  S.malzemeMeta[yeniKey].marka    = (document.getElementById('m-marka')?.value||'').trim();
  const _sktEl = document.getElementById('m-skt');
  if (_sktEl) S.malzemeMeta[yeniKey].skt = _sktEl.value || null;
  if (yeniKey!==eskiKey) { delete S.malzemeMeta[eskiKey]; }
  // Özel malzeme adını güncelle
  if (S.ozelMalzeme[eskiKey]) {
    S.ozelMalzeme[yeniKey] = {...S.ozelMalzeme[eskiKey], ad: yeniAd};
    if (yeniKey!==eskiKey) delete S.ozelMalzeme[eskiKey];
  } else if (yeniKey!==eskiKey) {
    // Kaynak malzeme yeniden adlandırıldı: silinmiş olarak işaretle, özel olarak ekle
    S.silinmis[eskiKey]=true;
    const srcItem = (KAYNAK[dep]||[]).find(i=>i.ad===eskiAd);
    S.ozelMalzeme[yeniKey]={ad:yeniAd, sayim:srcItem?.sayim||'—', depo:dep,
      birim:S.malzemeMeta[yeniKey]?.birim||'', kategori:S.malzemeMeta[yeniKey]?.kategori||''};
  }
  // Hareket geçmişinde adı güncelle
  if (yeniKey!==eskiKey) {
    S.hareketler.forEach(h=>{ if(h.depo===dep&&h.malzeme===eskiAd) h.malzeme=yeniAd; });
  }
  S.editKey.mal = yeniAd;
  closeModal('modal-stok');window.refreshAll();
  window.toast(yeniKey!==eskiKey ? '"'+yeniAd+'" olarak güncellendi.' : 'Stok güncellendi.');
}

export function closeModal(id) { document.getElementById(id).classList.remove('open'); }

export function filterMalzemeList() {
  const dep = document.getElementById('h-depo').value;
  const sel = document.getElementById('h-malzeme');
  if (!dep) { sel.innerHTML='<option>-- Önce depo seçin --</option>'; return; }
  sel.innerHTML = getDepoItems(dep).map(i=>{
    const s = getStok(dep, i.ad);
    const d = durum(s.mevcut, s.min, s.max);
    const flag = d==='Kritik' ? ' ⚠ kritik' : d==='Fazla' ? ' ↑ fazla' : '';
    const mm = S.malzemeMeta[getKey(dep,i.ad)]||{};
    const bir = mm.birim ? ` [${mm.birim}]` : '';
    return `<option value="${i.ad}">${i.ad}${bir} — ${s.mevcut} mevcut${flag}</option>`;
  }).join('') || '<option>Bu depoda malzeme yok</option>';
  // Seçili malzemenin stok bilgisini göster
  window.updateHareketStokBilgi();
}

// Expose on window for inline handlers
window.katBadgeHTML = katBadgeHTML;
window.setKatFilter = setKatFilter;
window.setKatFilterSel = setKatFilterSel;
window.setDurumFilter = setDurumFilter;
window.setDepoFilter = setDepoFilter;
window.stokSort = stokSort;
window.openStokModal = openStokModal;
window.saveStok = saveStok;
window.closeModal = closeModal;
window.filterMalzemeList = filterMalzemeList;
window.renderStokSutunMenu = renderStokSutunMenu;
window.toggleStokSutun = toggleStokSutun;
window.renderStok = renderStok;
