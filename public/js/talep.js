import { S, API_URL } from './state.js';
import { getAllItems, getStok, durum, depoBadge, esc, escQ, getKey, fmtGun, dClick, dInput, dChange } from './ui-common.js';
import { apiFetch } from './api.js';

// ═══════════════════════════════════════════════════════════════════
// TALEPNAME
// ═══════════════════════════════════════════════════════════════════

export function talepListesiYukle() {
  try { S._talepListesi = JSON.parse(localStorage.getItem('talepListesi') || '[]'); }
  catch(e) { S._talepListesi = []; }
}

export function talepListesiKaydet() {
  localStorage.setItem('talepListesi', JSON.stringify(S._talepListesi));
}

function _buildTalepMalListesi() {
  return getAllItems()
    .filter(i => !S.silinmis[getKey(i.depo, i.ad)])
    .map(i => {
      const s  = getStok(i.depo, i.ad);
      const mm = S.malzemeMeta[getKey(i.depo, i.ad)] || {};
      const d  = durum(s.mevcut, s.min, s.max);
      return { val: i.depo+'||'+i.ad, ad: i.ad, depo: i.depo,
               birim: mm.birim||'', mevcut: s.mevcut, min: s.min, durum: d };
    });
}

export function talepMalModalAc(n) {
  S._talepMalListesi = _buildTalepMalListesi();
  S._talepMalModalN  = n;
  S._talepMalModalDep = 'Tümü';
  const ara = document.getElementById('mal-sec-ara');
  if (ara) ara.value = '';
  const depolar = ['Tümü', ...new Set(S._talepMalListesi.map(m => m.depo))];
  const chipsEl = document.getElementById('mal-sec-depo-chips');
  if (chipsEl) {
    chipsEl.innerHTML = depolar.map(d =>
      `<div class="filter-chip${d==='Tümü'?' active':''}" ${dClick('_talepMalDepuSec',d)}>${esc(d)}</div>`
    ).join('');
  }
  _talepMalModalRender();
  document.getElementById('modal-mal-sec').classList.add('open');
  setTimeout(() => { if (ara) ara.focus(); }, 80);
}

export function _talepMalDepuSec(dep) {
  S._talepMalModalDep = dep;
  document.querySelectorAll('#mal-sec-depo-chips .filter-chip')
    .forEach(c => c.classList.toggle('active', c.textContent === dep));
  _talepMalModalRender();
}

export function _talepMalModalRender() {
  const q    = (document.getElementById('mal-sec-ara')?.value || '').toLowerCase().trim();
  const dep  = S._talepMalModalDep;
  let liste  = S._talepMalListesi;
  if (dep !== 'Tümü') liste = liste.filter(m => m.depo === dep);
  if (q) liste = liste.filter(m => m.ad.toLowerCase().includes(q) || m.depo.toLowerCase().includes(q));
  const listeEl = document.getElementById('mal-sec-liste');
  if (!listeEl) return;
  if (!liste.length) {
    listeEl.innerHTML = '<div class="mal-sec-empty">Sonuç bulunamadı</div>';
    return;
  }
  listeEl.innerHTML = liste.map(m => {
    const bir  = m.birim || 'adet';
    const krit = m.durum === 'Kritik';
    return `<div class="mal-sec-item" ${dClick('_talepMalModalSec',m.val,m.ad,m.depo,m.birim,m.mevcut,m.min)}>
      <div class="mal-sec-ad">${esc(m.ad)}</div>
      <div class="mal-sec-meta">
        ${depoBadge(m.depo)}
        <span class="mal-sec-stok${krit?' krit':''}">${m.mevcut} ${esc(bir)}${krit?' ⚠':''}</span>
      </div>
    </div>`;
  }).join('');
}

export function _talepMalModalSec(val, ad, dep, birim, mevcut, min) {
  window.closeModal('modal-mal-sec');
  _talepMalApply(S._talepMalModalN, val, ad, dep, birim, mevcut, min);
}

export function _talepMalApply(n, val, ad, dep, birim, mevcut, min) {
  const hid = document.getElementById('talep-hid-'+n);
  if (hid) hid.value = val;
  const cell = document.getElementById('talep-combo-'+n);
  if (cell) {
    cell.innerHTML = `<div class="talep-mal-secili">
      <span class="talep-mal-ad" ${dClick('talepMalModalAc',n)} title="Değiştirmek için tıklayın">${esc(ad)}</span>
      <button class="talep-mal-temizle" type="button" ${dClick('talepMalTemizle',n)} title="Temizle"><i data-lucide="x"></i></button>
    </div>`;
  }
  const tr = document.getElementById('talep-satir-'+n);
  if (tr) {
    const depEl  = tr.querySelector('.t-depo-cell');
    const birInp = tr.querySelector('.talep-birim');
    const mevEl  = tr.querySelector('.t-mevcut-cell');
    const mikInp = tr.querySelector('.talep-miktar');
    if (depEl)  depEl.innerHTML = depoBadge(dep);
    if (birInp) birInp.value   = birim || 'adet';
    const kritik = mevcut <= min;
    if (mevEl) mevEl.innerHTML = `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:${kritik?'var(--red)':'var(--ink2)'}">${mevcut}${kritik?' ⚠':''}</span>`;
    if (mikInp && kritik && !mikInp.value)
      mikInp.value = Math.max(1, min - mevcut + 1);
  }
  updateTalepToplam();
}

export function talepMalTemizle(n) {
  const hid = document.getElementById('talep-hid-'+n);
  if (hid) hid.value = '';
  const cell = document.getElementById('talep-combo-'+n);
  if (cell) cell.innerHTML = `<button class="talep-mal-btn" type="button" ${dClick('talepMalModalAc',n)}><i data-lucide="package" class="icon-inline"></i> Malzeme Seç</button>`;
  _talepSatirInfoTemizle(n);
  updateTalepToplam();
}

export function _talepSatirInfoTemizle(n) {
  const tr = document.getElementById('talep-satir-'+n);
  if (!tr) return;
  const depEl = tr.querySelector('.t-depo-cell');
  const mevEl = tr.querySelector('.t-mevcut-cell');
  if (depEl) depEl.innerHTML = '';
  if (mevEl) mevEl.innerHTML = '';
}

export function _talepMetaMirror() {
  const docNo   = document.getElementById('talep-no-display-doc');
  const docDate = document.getElementById('talep-tarih-display-doc');
  if (docNo)   docNo.textContent   = document.getElementById('talep-no-display')?.textContent   || '—';
  if (docDate) docDate.textContent = document.getElementById('talep-tarih-display')?.textContent || '';
}

export async function initTalep() {
  const kEl = document.getElementById('talep-form-kurum');
  if (kEl) kEl.textContent = S.ayarlar.kurumAdi || 'DYS – Depo Yönetim Sistemi';
  ['talep-no-display','talep-tarih-display'].forEach(id => {
    const el = document.getElementById(id);
    if (el) new MutationObserver(_talepMetaMirror).observe(el, {childList:true,subtree:true,characterData:true});
  });

  if (S._viewTalep) {
    const t = S._viewTalep; S._viewTalep = null;
    S.talepSatirCount = 0;
    document.getElementById('talep-tbody').innerHTML = '';
    document.getElementById('talep-no-display').textContent    = t.no;
    document.getElementById('talep-tarih-display').textContent = t.tarih;
    document.getElementById('t-birim').value    = t.birim    || '';
    document.getElementById('t-personel').value = t.personel || '';
    const acEl = document.getElementById('t-aciliyet');
    acEl.value = t.aciliyet || 'Normal';
    talepAciliyetGuncelle(acEl);
    document.getElementById('t-gerekce').value  = t.gerekce  || '';
    document.getElementById('imza1').value = t.imza1 || '';
    document.getElementById('imza2').value = t.imza2 || '';
    document.getElementById('imza3').value = t.imza3 || '';
    S._talepMalListesi = _buildTalepMalListesi();
    (t.satirlar || []).filter(s => s.ad).forEach(s => {
      talepSatirEkle(s.depo + '||' + s.ad);
      const tr = document.getElementById('talep-satir-' + S.talepSatirCount);
      if (tr) {
        const mikInp   = tr.querySelector('.talep-miktar');
        const birimInp = tr.querySelector('.talep-birim');
        if (mikInp)   mikInp.value   = s.miktar || 0;
        if (birimInp) birimInp.value = s.birim  || '';
      }
    });
    if (S.talepSatirCount === 0) talepSatirEkle();
    _talepDurumGoster(t.durum || 'Taslak');
    updateTalepToplam();
    return;
  }
  if (S.talepSatirCount === 0) {
    await yeniTalepno();
    if (S._pendingKritikler) {
      const list = S._pendingKritikler;
      S._pendingKritikler = null;
      list.forEach(k => {
        talepSatirEkle(k.depo + '||' + k.ad);
        const tr = document.getElementById('talep-satir-' + S.talepSatirCount);
        if (tr) {
          const mikInp = tr.querySelector('.talep-miktar');
          if (mikInp) mikInp.value = Math.max(1, k.min - k.mevcut + 1);
        }
      });
      updateTalepToplam();
      window.toast(`${list.length} kritik malzeme talepnameye aktarıldı ✓`);
    } else {
      for (let i=0;i<5;i++) talepSatirEkle();
    }
    if (S.ayarlar.talepSahibi)     { const el=document.getElementById('t-personel'); if(el&&!el.value) el.value=S.ayarlar.talepSahibi; }
    if (S.ayarlar.talepOnaylayan1) { const el=document.getElementById('imza1');      if(el&&!el.value) el.value=S.ayarlar.talepOnaylayan1; }
    if (S.ayarlar.talepOnaylayan2) { const el=document.getElementById('imza2');      if(el&&!el.value) el.value=S.ayarlar.talepOnaylayan2; }
    if (S.ayarlar.talepOnaylayan3) { const el=document.getElementById('imza3');      if(el&&!el.value) el.value=S.ayarlar.talepOnaylayan3; }
    _talepDurumGoster('Taslak');
  }
}

export async function yeniTalepno() {
  let no;
  if (S.API_MOD) {
    try {
      const r = await apiFetch(API_URL+'?action=talep_no');
      const j = await r.json();
      if (j.ok) no = j.no;
    } catch(e) { console.warn('talep_no:', e); }
  }
  if (!no) { S.talepNo++; no = (S.ayarlar.talepOnPek||'TLN')+'-'+String(S.talepNo).padStart(4,'0'); }
  document.getElementById('talep-no-display').textContent = no;
  document.getElementById('talep-tarih-display').textContent = fmtGun(new Date());
}

export function talepKaydet(durum = 'Taslak') {
  const no    = document.getElementById('talep-no-display')?.textContent||'';
  const tarih = document.getElementById('talep-tarih-display')?.textContent||'';
  const satirlar = [];
  document.querySelectorAll('#talep-tbody tr').forEach(tr => {
    const hid    = tr.querySelector('[id^="talep-hid-"]');
    const inp    = tr.querySelector('[id^="talep-inp-"]');
    const birim  = tr.querySelector('.talep-birim');
    const miktar = tr.querySelector('.talep-miktar');
    const mik    = parseInt(miktar?.value);
    if (!Number.isFinite(mik) || mik <= 0) return;
    if (hid?.value) {
      const [dep, ad] = hid.value.split('||');
      satirlar.push({ ad, depo: dep, birim: birim?.value||'', miktar: mik });
    } else if (inp?.value.trim()) {
      satirlar.push({ ad: inp.value.trim(), depo: '', birim: birim?.value||'', miktar: mik });
    }
  });
  if (!satirlar.length) { window.toast('En az 1 malzeme ve geçerli miktar girin','error'); return; }
  const payload = {
    no, tarih, durum,
    birim   : document.getElementById('t-birim')?.value||'',
    personel: document.getElementById('t-personel')?.value||'',
    aciliyet: document.getElementById('t-aciliyet')?.value||'Normal',
    gerekce : document.getElementById('t-gerekce')?.value||'',
    satirlar,
    imza1: document.getElementById('imza1')?.value||'',
    imza2: document.getElementById('imza2')?.value||'',
    imza3: document.getElementById('imza3')?.value||'',
  };
  talepListesiYukle();
  const idx = S._talepListesi.findIndex(t => t.no === no);
  if (idx >= 0) { S._talepListesi[idx] = { ...S._talepListesi[idx], ...payload }; }
  else          { payload.id = Date.now(); S._talepListesi.push(payload); }
  talepListesiKaydet();
  if (S.API_MOD) {
    apiFetch(API_URL+'?action=talep_kaydet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(r=>r.json()).then(j=>{
        if (j.ok && j.no) document.getElementById('talep-no-display').textContent = j.no;
        else if (!j.ok) window.toast('Talep sunucuya kaydedilemedi: ' + (j.error||''), 'error');
      })
      .catch(e => { console.warn('talep_kaydet:', e); window.toast('Sunucuya kaydedilemedi, yerelde tutuldu', 'error'); });
  }
  const msg = durum==='Taslak' ? 'taslak olarak kaydedildi' : 'onaya gönderildi';
  window.toast(`Talep ${no} ${msg} ✓`);
  _talepDurumGoster(durum);
}

export function talepAyarlaraKaydet() {
  const personel = document.getElementById('t-personel')?.value.trim();
  const imza1    = document.getElementById('imza1')?.value.trim();
  const imza2    = document.getElementById('imza2')?.value.trim();
  const imza3    = document.getElementById('imza3')?.value.trim();
  if (personel) S.ayarlar.talepSahibi      = personel;
  if (imza1)    S.ayarlar.talepOnaylayan1  = imza1;
  if (imza2)    S.ayarlar.talepOnaylayan2  = imza2;
  if (imza3)    S.ayarlar.talepOnaylayan3  = imza3;
  window.ayarlariKaydet();
  window.toast('Personel ve imza bilgileri ayarlara kaydedildi ✓');
}

export function talepOnayaGonder() {
  talepKaydet('Onay Bekliyor');
}

export function talepSifirla() {
  S.talepSatirCount = 0;
  document.getElementById('talep-tbody').innerHTML = '';
  ['t-birim','t-personel','t-gerekce','imza1','imza2','imza3'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const acEl = document.getElementById('t-aciliyet'); if (acEl) { acEl.value = 'Normal'; talepAciliyetGuncelle(acEl); }
  yeniTalepno().then(() => {
    for (let i=0;i<5;i++) talepSatirEkle();
    if (S.ayarlar.talepSahibi)     { const el=document.getElementById('t-personel'); if(el) el.value=S.ayarlar.talepSahibi; }
    if (S.ayarlar.talepOnaylayan1) { const el=document.getElementById('imza1');      if(el) el.value=S.ayarlar.talepOnaylayan1; }
    if (S.ayarlar.talepOnaylayan2) { const el=document.getElementById('imza2');      if(el) el.value=S.ayarlar.talepOnaylayan2; }
    if (S.ayarlar.talepOnaylayan3) { const el=document.getElementById('imza3');      if(el) el.value=S.ayarlar.talepOnaylayan3; }
    _talepDurumGoster('Taslak');
    updateTalepToplam();
  });
}

function _talepDurumGoster(dur) {
  const el = document.getElementById('talep-durum-badge');
  if (!el) return;
  const cls = { 'Taslak':'taslak','Onay Bekliyor':'onay-bekliyor','Onaylı':'onayli','Reddedildi':'reddedildi' };
  el.innerHTML = dur ? `<span class="talep-durum-badge ${cls[dur]||'taslak'}">${dur}</span>` : '';
  const stamp = document.getElementById('ts-stamp');
  const stampTxt = document.getElementById('ts-stamp-text');
  if (stamp && stampTxt) {
    stamp.className = 'ts-stamp';
    const stamps = {'Taslak':'ts-stamp-taslak','Onay Bekliyor':'ts-stamp-onay','Onaylı':'ts-stamp-onayli','Reddedildi':'ts-stamp-red'};
    stamp.classList.add(stamps[dur] || 'ts-stamp-taslak');
    const labels = {'Taslak':'TASLAK','Onay Bekliyor':'ONAY\nBEKLİYOR','Onaylı':'ONAYLANDI','Reddedildi':'REDDEDİLDİ'};
    stampTxt.textContent = labels[dur] || dur;
  }
}

export function renderTalepListesi() {
  const el = document.getElementById('talep-listesi-icerik');
  if (!el) return;
  talepListesiYukle();
  const durumFilter = document.getElementById('tl-durum-filter')?.value || '';
  const liste = [...S._talepListesi].reverse().filter(t => !durumFilter || t.durum === durumFilter);
  if (!liste.length) {
    el.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--muted);font-size:13px">Kayıtlı talep bulunamadı.</p></div></div>';
    return;
  }
  const acilRenk = { 'Normal':'var(--ink2)', 'Acil':'var(--amber)', 'Çok Acil':'var(--red)' };
  const durumCls = d => ({ 'Taslak':'taslak','Onay Bekliyor':'onay-bekliyor','Onaylı':'onayli','Reddedildi':'reddedildi' }[d]||'taslak');
  el.innerHTML = `<div class="card" style="overflow:hidden"><div style="overflow-x:auto">
    <table id="talep-list-table">
      <thead><tr>
        <th>Talep No</th><th>Tarih</th><th>Birim</th><th>Personel</th>
        <th>Aciliyet</th><th style="text-align:center">Kalem</th>
        <th>Durum</th><th></th>
      </tr></thead>
      <tbody>
      ${liste.map(t => {
        const kalem = (t.satirlar||[]).filter(s=>s.ad).length;
        const d = t.durum || 'Taslak';
        const bekliyor = d === 'Onay Bekliyor';
        return `<tr>
          <td><strong style="font-family:'IBM Plex Mono',monospace;font-size:12px">${esc(t.no)}</strong></td>
          <td style="font-size:12px">${esc(t.tarih||'—')}</td>
          <td>${esc(t.birim||'—')}</td>
          <td>${esc(t.personel||'—')}</td>
          <td style="color:${acilRenk[t.aciliyet]||'var(--ink2)'}"><strong>${esc(t.aciliyet||'Normal')}</strong></td>
          <td style="text-align:center">${kalem}</td>
          <td><span class="talep-durum-badge ${durumCls(d)}">${esc(d)}</span></td>
          <td style="text-align:right;white-space:nowrap;display:flex;gap:4px;justify-content:flex-end">
            ${bekliyor ? `<button class="btn btn-sm btn-success" ${dClick('talepDurumGuncelle',t.id,'Onaylı')}><i data-lucide="check" class="icon-inline"></i> Onayla</button>
              <button class="btn btn-sm btn-danger-soft" ${dClick('talepDurumGuncelle',t.id,'Reddedildi')}><i data-lucide="x" class="icon-inline"></i> Reddet</button>` : ''}
            <button class="btn btn-sm btn-outline" ${dClick('talepGoruntule',t.id)}><i data-lucide="eye" class="icon-inline"></i> Görüntüle</button>
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
  </div></div>`;
  if (S.API_MOD) {
    apiFetch(API_URL+'?action=talep_list').then(r=>r.json()).then(j=>{
      if (j.ok && j.talepler?.length) {
        j.talepler.forEach(at => { if (!S._talepListesi.find(x=>x.no===at.no)) S._talepListesi.push({...at}); });
        talepListesiKaydet();
      }
    }).catch(e => { console.warn('talep_list:', e); });
  }
}

export function talepDurumGuncelle(id, yeniDurum) {
  talepListesiYukle();
  const t = S._talepListesi.find(x => x.id === id);
  if (t) { t.durum = yeniDurum; talepListesiKaydet(); window.toast(`Durum → ${yeniDurum} ✓`); renderTalepListesi(); }
  if (S.API_MOD) {
    apiFetch(API_URL+'?action=talep_durum',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,durum:yeniDurum})})
      .then(r=>r.json()).then(j=>{ if(!j.ok) window.toast('Durum sunucuya yansıtılamadı: '+(j.error||''), 'error'); })
      .catch(e => { console.warn('talep_durum:', e); window.toast('Sunucu bağlantı hatası', 'error'); });
  }
}

export function talepGoruntule(id) {
  const t = S._talepListesi.find(x => x.id === id);
  if (!t) { window.toast('Talep bulunamadı', 'error'); return; }
  S._viewTalep = t;
  S.talepSatirCount = 0;
  window.navigate('talep');
}

export function talepSatirEkle(malzemeVal) {
  S.talepSatirCount++;
  const tbody = document.getElementById('talep-tbody');
  const tr = document.createElement('tr');
  tr.id = 'talep-satir-' + S.talepSatirCount;
  const n = S.talepSatirCount;
  tr.innerHTML = `
    <td style="text-align:center;color:var(--muted);font-family:'IBM Plex Mono',monospace;font-size:11px">${n}</td>
    <td style="min-width:180px">
      <input type="hidden" id="talep-hid-${n}" value="">
      <div class="talep-mal-cell" id="talep-combo-${n}">
        <button class="talep-mal-btn" type="button" ${dClick('talepMalModalAc',n)}><i data-lucide="package" class="icon-inline"></i> Malzeme Seç</button>
      </div>
    </td>
    <td class="t-depo-cell"></td>
    <td><input type="text" class="talep-birim" placeholder="adet" style="width:100%"></td>
    <td class="t-mevcut-cell" style="text-align:center"></td>
    <td><input type="number" class="talep-miktar" min="0" placeholder="0" ${dInput('updateTalepToplam')}></td>
    <td class="no-print" style="text-align:center">
      <button ${dClick('talepSatirSil',n)} class="btn btn-sm btn-ghost btn-icon" title="Satırı sil"><i data-lucide="x"></i></button>
    </td>`;
  tbody.appendChild(tr);
  if (malzemeVal) {
    if (!S._talepMalListesi.length) S._talepMalListesi = _buildTalepMalListesi();
    const m = S._talepMalListesi.find(x => x.val === malzemeVal);
    if (m) _talepMalApply(n, m.val, m.ad, m.depo, m.birim, m.mevcut, m.min);
  }
  updateTalepToplam();
}

export function talepSatirSil(n) {
  const tr = document.getElementById('talep-satir-' + n);
  if (!tr) return;
  const hid = tr.querySelector('[id^="talep-hid-"]');
  const inp = tr.querySelector('[id^="talep-inp-"]');
  const val = hid?.value || inp?.value.trim();
  if (val && !confirm('Bu satırı silmek istediğinizden emin misiniz?')) return;
  tr.remove();
  updateTalepToplam();
}

export function updateTalepToplam() {}

export function talepAciliyetGuncelle(sel) {
  sel.className = '';
  if (sel.value === 'Acil')      sel.className = 'talep-aciliyet-acil';
  if (sel.value === 'Çok Acil')  sel.className = 'talep-aciliyet-cokacil';
}

// Expose on window for inline handlers
window.talepListesiYukle = talepListesiYukle;
window.talepMalModalAc = talepMalModalAc;
window._talepMalDepuSec = _talepMalDepuSec;
window._talepMalModalRender = _talepMalModalRender;
window._talepMalModalSec = _talepMalModalSec;
window.talepMalTemizle = talepMalTemizle;
window.initTalep = initTalep;
window.yeniTalepno = yeniTalepno;
window.talepKaydet = talepKaydet;
window.talepAyarlaraKaydet = talepAyarlaraKaydet;
window.talepOnayaGonder = talepOnayaGonder;
window.talepSifirla = talepSifirla;
window.renderTalepListesi = renderTalepListesi;
window.talepDurumGuncelle = talepDurumGuncelle;
window.talepGoruntule = talepGoruntule;
window.talepSatirEkle = talepSatirEkle;
window.talepSatirSil = talepSatirSil;
window.updateTalepToplam = updateTalepToplam;
window.talepAciliyetGuncelle = talepAciliyetGuncelle;
