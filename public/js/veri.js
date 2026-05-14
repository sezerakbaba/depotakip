import { S, API_URL } from './state.js';
import { getAllItems, getStok, durum, esc, escQ, getKey } from './ui-common.js';
import { apiFetch, apiBackupList, apiBackupLoad } from './api.js';

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
      <button class="btn btn-sm btn-outline" onclick="apiBackupLoad('${escQ(y.dosya)}')">↩ Yükle</button>
    </div>`).join('');
}

export function refreshVeriYonet() {
  const toplam = getAllItems().length;
  const ozelC  = Object.keys(S.ozelMalzeme).length;
  document.getElementById('export-toplam').textContent  = toplam;
  document.getElementById('export-hareket').textContent = S.hareketler.length;
  document.getElementById('export-ozel').textContent    = ozelC;
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
  const q = (document.getElementById('har-search')?.value || '').toLowerCase();
  const filtered = S.hareketler.filter(h => {
    if (S.harFilter !== 'Tümü' && h.tur !== S.harFilter) return false;
    if (S.harDepoFilter && h.depo !== S.harDepoFilter) return false;
    if (S.harPersonelFilter && !(h.personel||'').toLowerCase().includes(S.harPersonelFilter.toLowerCase())) return false;
    if (q && !h.malzeme.toLowerCase().includes(q) && !h.depo.toLowerCase().includes(q) &&
        !(h.personel||'').toLowerCase().includes(q) && !(h.belge||'').toLowerCase().includes(q)) return false;
    if (S.harTarihBas) { const hd = new Date(h.tarih); hd.setHours(0,0,0,0); if (hd < new Date(S.harTarihBas + 'T00:00:00')) return false; }
    if (S.harTarihBit) { const hd = new Date(h.tarih); hd.setHours(0,0,0,0); if (hd > new Date(S.harTarihBit + 'T00:00:00')) return false; }
    return true;
  }).slice().reverse();
  if (filtered.length === 0) { window.toast('Dışa aktarılacak kayıt yok.', 'error'); return; }
  const rows = [['Tarih', 'Depo', 'Malzeme', 'Tür', 'Miktar', 'Belge No', 'Personel', 'Not']];
  filtered.forEach(h => rows.push([
    new Date(h.tarih).toLocaleString('tr-TR'), h.depo, h.malzeme,
    h.tur, h.miktar, h.belge || '', h.personel || '', h.not || ''
  ]));
  const wb = window.XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Hareket Geçmişi');
  XLSX.writeFile(wb, 'hareket_' + new Date().toLocaleDateString('tr-TR').replace(/\./g, '-') + '.xlsx');
  window.toast(`${filtered.length} kayıt Excel'e aktarıldı ✓`);
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

  const harRows = [['Tarih','Depo','Malzeme','Tür','Miktar','Belge','Personel','Not']];
  [...S.hareketler].reverse().forEach(h => {
    harRows.push([new Date(h.tarih).toLocaleString('tr-TR'), h.depo, h.malzeme,
      h.tur, h.miktar, h.belge||'', h.personel||'', h.not||'']);
  });
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

export function veriDisaAktar() {
  const payload = {
    version:'2.1',
    tarih:new Date().toISOString(),
    stok:S.stok, hareketler:S.hareketler, ozelMalzeme:S.ozelMalzeme, silinmis:S.silinmis, malzemeMeta:S.malzemeMeta
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

export function veriIceAktar(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.stok) { window.toast('Geçersiz dosya formatı!','error'); return; }
      S.stok=data.stok||{}; S.hareketler=data.hareketler||[];
      S.ozelMalzeme=data.ozelMalzeme||{}; S.silinmis=data.silinmis||{}; S.malzemeMeta=data.malzemeMeta||{};
      window.refreshAll();
      refreshVeriYonet();
      window.toast(`Veri yüklendi: ${S.hareketler.length} hareket, ${Object.keys(S.stok).length} stok kaydı ✓`);
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
