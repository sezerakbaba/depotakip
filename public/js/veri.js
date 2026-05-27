import { S, API_URL } from './state.js';
import { getAllItems, getStok, durum, esc, escQ, getKey, dClick } from './ui-common.js';
import { apiFetch, apiBackupList, apiBackupLoad, apiHareketList } from './api.js';

// ═══════════════════════════════════════════════════════════════════
// VERİ YÖNETİMİ – DIŞA / İÇE AKTAR
// ═══════════════════════════════════════════════════════════════════

export async function renderBackupList() {
  const kart = document.getElementById('api-yedek-kart');
  const liste = document.getElementById('api-yedek-liste');
  if (!kart || !liste) return;
  if (!S.API_MOD) { kart.style.display='none'; return; }
  kart.style.display='block';
  liste.innerHTML='<p style="font-size:13px;color:var(--muted)">Yükleniyor...</p>';
  const yedekler = await apiBackupList();
  if (!yedekler.length) {
    liste.innerHTML='<p style="font-size:13px;color:var(--muted)">Henüz yedek yok.</p>'; return;
  }
  liste.innerHTML = yedekler.map(y=>`
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600;font-family:'IBM Plex Mono',monospace">${esc(y.tarih)}</div>
        <div style="font-size:10px;color:var(--muted)">${esc(y.dosya)} · ${esc(y.boyut)}</div>
      </div>
      <button class="btn btn-sm btn-outline" ${dClick('apiBackupLoad',y.dosya)}>↩ Yükle</button>
    </div>`).join('');
}

export async function refreshVeriYonet() {
  const toplam = getAllItems().length;
  const ozelC  = Object.keys(S.ozelMalzeme).length;
  document.getElementById('export-toplam').textContent  = toplam;
  document.getElementById('export-ozel').textContent    = ozelC;
  // Hareket sayısını sunucudan al
  const harEl = document.getElementById('export-hareket');
  if (harEl) harEl.textContent = '…';
  if (S.API_MOD) {
    try {
      const result = await apiHareketList({ limit: 1, offset: 0 });
      if (harEl) harEl.textContent = result.toplam;
    } catch(e) {
      if (harEl) harEl.textContent = '?';
    }
  } else {
    if (harEl) harEl.textContent = '—';
  }
}

export async function exportHareketExcel() {
  if (!window.XLSX) {
    window.toast('Excel kütüphanesi yükleniyor...');
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = res; s.onerror = () => rej(new Error('SheetJS yüklenemedi'));
      document.head.appendChild(s);
    }).catch(e => { window.toast('Excel kütüphanesi yüklenemedi: ' + e.message, 'error'); throw e; });
  }
  if (!S.API_MOD) { window.toast('Sunucu bağlantısı gerekli', 'error'); return; }
  const q   = (document.getElementById('har-search')?.value || '').trim();
  const tur = S.harFilter !== 'Tümü' ? S.harFilter : '';
  window.toast('Hareketler indiriliyor…');
  try {
    const result = await apiHareketList({
      offset: 0, limit: 999999,
      depo: S.harDepoFilter || '',
      tur,
      tarih_min: S.harTarihBas || '',
      tarih_max: S.harTarihBit || '',
      q,
    });
    const filtered = result.hareketler;
    if (!filtered.length) { window.toast('Dışa aktarılacak kayıt yok.', 'error'); return; }
    const rows = [['Tarih', 'Depo', 'Malzeme', 'Tür', 'Miktar', 'Belge No', 'Personel', 'Not']];
    filtered.forEach(h => rows.push([
      new Date(h.tarih).toLocaleString('tr-TR'), h.depo, h.malzeme,
      h.tur, h.miktar, h.belge || '', h.personel || '', h.not || ''
    ]));
    const wb = window.XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Hareket Geçmişi');
    XLSX.writeFile(wb, 'hareket_' + new Date().toLocaleDateString('tr-TR').replace(/\./g, '-') + '.xlsx');
    window.toast(`${filtered.length} kayıt Excel'e aktarıldı ✓`);
  } catch(e) {
    window.toast('Excel dışa aktarma hatası: ' + e.message, 'error');
  }
}

export async function veriExcelAktar() {
  if (!window.XLSX) {
    window.toast('Excel kütüphanesi yükleniyor...');
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = res; s.onerror = () => rej(new Error('SheetJS yüklenemedi'));
      document.head.appendChild(s);
    }).catch(e => { window.toast('Excel kütüphanesi yüklenemedi: ' + e.message, 'error'); throw e; });
  }
  const wb = window.XLSX.utils.book_new();

  const stokRows = [['#','Malzeme Adı','Depo','Birim','Kategori','Mevcut','Min','Max','Durum']];
  let idx = 1;
  getAllItems().forEach(item => {
    const s  = getStok(item.depo, item.ad);
    const mm = S.malzemeMeta[getKey(item.depo, item.ad)] || {};
    stokRows.push([idx++, item.ad, item.depo, mm.birim||item.birim||'', item.kategori||mm.kategori||'',
      s.mevcut, s.min, s.max, durum(s.mevcut, s.min, s.max)]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stokRows), 'Stok Listesi');

  // Hareketler sunucudan
  const harRows = [['Tarih','Depo','Malzeme','Tür','Miktar','Belge','Personel','Not']];
  if (S.API_MOD) {
    try {
      const result = await apiHareketList({ offset: 0, limit: 999999 });
      result.hareketler.forEach(h => {
        harRows.push([new Date(h.tarih).toLocaleString('tr-TR'), h.depo, h.malzeme,
          h.tur, h.miktar, h.belge||'', h.personel||'', h.not||'']);
      });
    } catch(e) { console.warn('Excel hareket export:', e); }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(harRows), 'Hareket Geçmişi');

  const sktRows = [['Malzeme','Mevcut','Son Kullanma Tarihi','Durum']];
  getAllItems().filter(i => i.depo === 'Kimyasal Deposu').forEach(item => {
    const mm = S.malzemeMeta[getKey(item.depo, item.ad)] || {};
    const s  = getStok(item.depo, item.ad);
    const sd = mm.skt ? window.sktDurum(mm.skt) : null;
    sktRows.push([item.ad, s.mevcut, mm.skt || '', sd ? sd.label : '']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sktRows), 'Kimyasal SKT');

  const tarih = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
  XLSX.writeFile(wb, 'depo_rapor_' + tarih + '.xlsx');
  window.toast('Excel raporu indirildi ✓');
}

export async function veriDisaAktar() {
  let hareketler = [];
  if (S.API_MOD) {
    try {
      const result = await apiHareketList({ offset: 0, limit: 999999 });
      hareketler = result.hareketler;
    } catch(e) { console.warn('JSON export hareket:', e); }
  }
  const payload = {
    version:'2.2',
    tarih: new Date().toISOString(),
    stok: S.stok,
    hareketler,
    ozelMalzeme: S.ozelMalzeme,
    silinmis: S.silinmis,
    malzemeMeta: S.malzemeMeta,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `depo_takip_${new Date().toLocaleDateString('tr-TR').replace(/\./g,'-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  window.toast('JSON dosyası indirildi ✓');
}

export async function veriIceAktar(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.stok) { window.toast('Geçersiz dosya formatı!','error'); return; }
      S.stok        = data.stok        || {};
      S.ozelMalzeme = data.ozelMalzeme || {};
      S.silinmis    = data.silinmis    || {};
      S.malzemeMeta = data.malzemeMeta || {};
      window.refreshAll();

      // Hareketleri sunucuya gönder
      const hareketler = data.hareketler || data._hareketler || [];
      let harMesaj = '';
      if (hareketler.length > 0 && S.API_MOD) {
        try {
          const r = await apiFetch(API_URL + '?action=hareket_toplu_ekle', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ hareketler }),
          });
          const json = await r.json();
          harMesaj = json.ok ? `, ${hareketler.length} hareket` : '';
        } catch(ex) { console.warn('Hareket import:', ex); }
      }

      await refreshVeriYonet();
      window.toast(`Veri yüklendi: ${Object.keys(data.stok).length} stok kaydı${harMesaj} ✓`);
    } catch(err) {
      window.toast('Dosya okunamadı: ' + err.message, 'error');
    }
    input.value='';
  };
  reader.readAsText(file);
}

// Expose on window for inline handlers
window.renderBackupList = renderBackupList;
window.refreshVeriYonet = refreshVeriYonet;
window.exportHareketExcel = exportHareketExcel;
window.veriExcelAktar = veriExcelAktar;
window.veriDisaAktar = veriDisaAktar;
window.veriIceAktar = veriIceAktar;
// re-expose apiBackupLoad for inline handlers
window.apiBackupLoad = apiBackupLoad;
