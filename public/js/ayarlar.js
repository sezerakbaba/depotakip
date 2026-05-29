import { S, AYARLAR_DEFAULT, DEPO_META, DEPO_BADGE, KAT_COLORS, API_URL } from './state.js';
import { esc, dClick, dChange, dInput, dKeydown, setFieldError, clearFieldErrors, notificationDurumu } from './ui-common.js';
import { apiFetch } from './api.js';

// ═══════════════════════════════════════════════════════════════════
// AYARLAR
// ═══════════════════════════════════════════════════════════════════

export function ayarlariYukle() {
  try {
    const stored = JSON.parse(localStorage.getItem('depoAyarlar') || '{}');
    S.ayarlar = { ...AYARLAR_DEFAULT, ...stored };
    (S.ayarlar.ekDepo || []).forEach(d => {
      DEPO_META[d.ad]  = { kod: d.kod, cls: '', color: d.color };
      DEPO_BADGE[d.ad] = '';
    });
    (S.ayarlar.ekKategori || []).forEach(k => {
      KAT_COLORS[k.ad] = { c: k.c, bg: k.bg };
    });
    Object.entries(S.ayarlar.depoYeniadlar || {}).forEach(([orig, yeni]) => {
      if (DEPO_META[orig] && orig !== yeni) {
        DEPO_META[yeni] = DEPO_META[orig]; delete DEPO_META[orig];
        DEPO_BADGE[yeni] = DEPO_BADGE[orig] || ''; delete DEPO_BADGE[orig];
      }
    });
    Object.entries(S.ayarlar.katYeniadlar || {}).forEach(([orig, yeni]) => {
      if (KAT_COLORS[orig] && orig !== yeni) {
        KAT_COLORS[yeni] = KAT_COLORS[orig]; delete KAT_COLORS[orig];
      }
    });
  } catch(e) { S.ayarlar = { ...AYARLAR_DEFAULT }; }
  applyTheme();
}

export function ayarlariKaydet() {
  localStorage.setItem('depoAyarlar', JSON.stringify(S.ayarlar));
}

export function applyTheme() {
  const t = S.ayarlar.tema;
  if (t === 'dark')       document.documentElement.setAttribute('data-theme', 'dark');
  else if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else                    document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.fontSize = (S.ayarlar.yazitipiBoy || 100) + '%';
  const el = document.getElementById('sidebar-kurum-adi');
  if (el) el.textContent = S.ayarlar.kurumAdi || 'Depo Yönetim Sistemi';
}

// Hızlı/sürekli değişen ayarlarda (range slider, type-as-you-go) toast spam'i
// önlemek için 600ms debounce — son durdurmadan sonra tek toast.
let _ayarToastT = null;
function _ayarToastDebounced() {
  clearTimeout(_ayarToastT);
  _ayarToastT = setTimeout(() => window.toast?.('Ayarlar kaydedildi ✓'), 600);
}
export function setAyar(key, val) {
  S.ayarlar[key] = val; ayarlariKaydet();
  if (key === 'kurumAdi') {
    const el = document.getElementById('sidebar-kurum-adi');
    if (el) el.textContent = val || 'Depo Yönetim Sistemi';
    document.title = (val || 'Depo Yönetim Sistemi') + ' — Depo Takip';
  }
  _ayarToastDebounced();
}

export function setTema(t) {
  S.ayarlar.tema = t; applyTheme(); ayarlariKaydet(); renderAyarlar();
}

export function setAyarlarTab(t) {
  S.ayarlarAktifTab = t;
  S.ayarlarArama = '';
  renderAyarlar();
}

export function ayarlarAraOlay(q) {
  S.ayarlarArama = q || '';
  renderAyarlar();
}

function _ayarlarAramaFiltre(terim) {
  const panel = document.getElementById('ayarlar-panel-icerik');
  if (!panel) return;
  const t = terim.toLocaleLowerCase('tr');
  panel.querySelectorAll('.card').forEach(card => {
    let gorunurSatir = 0;
    card.querySelectorAll('.ayar-row').forEach(row => {
      const match = row.textContent.toLocaleLowerCase('tr').includes(t);
      row.style.display = match ? '' : 'none';
      if (match) gorunurSatir++;
    });
    card.style.display = gorunurSatir === 0 ? 'none' : '';
  });
}

export function renderAyarlar() {
  const el = document.getElementById('ayarlar-icerik');
  if (!el) return;

  const depList = Object.keys(DEPO_META);
  const depOpts = depList.map(d => `<option value="${d}"${S.ayarlar.varsayilanDepo===d?' selected':''}>${d}</option>`).join('');

  const kurumHtml = `<div class="card"><div class="card-header"><i data-lucide="building-2" class="icon-inline"></i> Kurum Bilgisi</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">Kurum / Sistem Adı<small>Başlık ve talepname üst bilgisinde görünür</small></div>
      <input type="text" class="ayar-input-full" maxlength="100" value="${esc(S.ayarlar.kurumAdi||'')}" ${dChange('setAyarTrim','kurumAdi')} placeholder="Depo Yönetim Sistemi"></div>
  </div></div>`;

  const temaHtml = `<div class="card"><div class="card-header"><i data-lucide="palette" class="icon-inline"></i> Görünüm</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">Tema<small>Açık / Koyu / Sistem</small></div>
      <div class="btn-group">
        <button class="btn btn-sm ${S.ayarlar.tema==='light'?'btn-primary':'btn-outline'}" ${dClick('setTema','light')}><i data-lucide="sun" class="icon-inline"></i> Açık</button>
        <button class="btn btn-sm ${S.ayarlar.tema==='dark'?'btn-primary':'btn-outline'}" ${dClick('setTema','dark')}><i data-lucide="moon" class="icon-inline"></i> Koyu</button>
        <button class="btn btn-sm ${S.ayarlar.tema==='auto'?'btn-primary':'btn-outline'}" ${dClick('setTema','auto')}><i data-lucide="monitor" class="icon-inline"></i> Otomatik</button>
      </div></div>
    <div class="ayar-row"><div class="ayar-label">Yazı Tipi Boyutu<small id="yazitipiBoy-lbl">Şu an: ${S.ayarlar.yazitipiBoy||100}%</small></div>
      <input type="range" min="80" max="130" step="5" value="${S.ayarlar.yazitipiBoy||100}"
        ${dInput('yazitipiBoy')}
        style="width:160px"></div>
    <div class="ayar-row"><div class="ayar-label">Tarih Formatı<small>Listelerde görünen tarih biçimi</small></div>
      <div class="btn-group">
        <button class="btn btn-sm ${S.ayarlar.tarihFormat==='tr'?'btn-primary':'btn-outline'}" ${dClick('setTarihFormat','tr')}>TR (31.12.2025)</button>
        <button class="btn btn-sm ${S.ayarlar.tarihFormat==='iso'?'btn-primary':'btn-outline'}" ${dClick('setTarihFormat','iso')}>ISO (2025-12-31)</button>
      </div></div>
  </div></div>`;

  const esikHtml = `<div class="card"><div class="card-header"><i data-lucide="gauge" class="icon-inline"></i> Eşik & Limitler</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">SKT Uyarı Eşiği (gün)<small>Son kullanma tarihine bu kadar gün kala uyar</small></div>
      <input type="number" class="ayar-input" min="1" max="730" value="${S.ayarlar.sktUyariGun}" ${dChange('setAyarNum','sktUyariGun')}></div>
    <div class="ayar-row"><div class="ayar-label">SKT Kritik Eşiği (gün)<small>Bu kadar günden az kaldıysa kırmızı göster</small></div>
      <input type="number" class="ayar-input" min="1" max="365" value="${S.ayarlar.sktKritikGun}" ${dChange('setAyarNum','sktKritikGun')}></div>
    <div class="ayar-row"><div class="ayar-label">Dashboard kritik limit<small>Kritik listede en fazla kaç satır gösterilsin</small></div>
      <input type="number" class="ayar-input" min="1" max="50" value="${S.ayarlar.dashKritikLimit}" ${dChange('setAyarNum','dashKritikLimit')}></div>
    <div class="ayar-row"><div class="ayar-label">Dashboard son hareketler<small>Ana sayfada kaç hareket gösterilsin</small></div>
      <input type="number" class="ayar-input" min="1" max="50" value="${S.ayarlar.sonHareketLimit||8}" ${dChange('setAyarNum','sonHareketLimit')}></div>
    <div class="ayar-row"><div class="ayar-label">Stok listesi sayfa boyutu<small>Sayfa başına kaç satır</small></div>
      <input type="number" class="ayar-input" min="10" max="500" value="${S.ayarlar.stokSayfaBoy||100}" ${dChange('setAyarNum','stokSayfaBoy')}></div>
    <div class="ayar-row"><div class="ayar-label">Hareket listesi sayfa boyutu<small>Sayfa başına kaç satır</small></div>
      <input type="number" class="ayar-input" min="10" max="500" value="${S.ayarlar.harSayfaBoy||50}" ${dChange('setAyarNum','harSayfaBoy')}></div>
    <div class="ayar-row"><div class="ayar-label">Varsayılan depo<small>Hareket ve ekleme formlarında otomatik seçilir</small></div>
      <select class="ayar-input-sel" ${dChange('setAyarStr','varsayilanDepo')}>
        <option value="">— Seçilmedi —</option>${depOpts}
      </select></div>
    <div class="ayar-row"><div class="ayar-label">Varsayılan min stok<small>Yeni malzeme eklerken ön değer</small></div>
      <input type="number" class="ayar-input" min="0" value="${S.ayarlar.varsayilanMinStok??1}" ${dChange('setAyarNum','varsayilanMinStok')}></div>
    <div class="ayar-row"><div class="ayar-label">Varsayılan max stok</div>
      <input type="number" class="ayar-input" min="0" value="${S.ayarlar.varsayilanMaxStok??10}" ${dChange('setAyarNum','varsayilanMaxStok')}></div>
    <div class="ayar-row"><div class="ayar-label">Kategori seçimi zorunlu<small>Malzeme eklerken kategori boş bırakılamaz</small></div>
      <input type="checkbox" ${S.ayarlar.katZorunlu?'checked':''} ${dChange('setAyarBool','katZorunlu')}></div>
    <div class="ayar-row"><div class="ayar-label">Hareket notu zorunlu<small>Giriş/çıkış kaydederken not alanı boş bırakılamaz</small></div>
      <input type="checkbox" ${S.ayarlar.hareketNot?'checked':''} ${dChange('setAyarBool','hareketNot')}></div>
    <div class="ayar-row"><div class="ayar-label">Kritik stok bildirimi<small>${
      ({
        unsupported: 'Tarayıcınız desteklemiyor',
        insecure:    "HTTPS gerektirir (sunucu HTTP'de bildirim alınmaz)",
        granted:     'İzin verildi ✓',
        denied:      'Tarayıcıda engellendi',
        default:     'İzin gerekiyor',
      })[notificationDurumu()] || 'Bilinmiyor'
    }</small></div>
      <button class="btn btn-sm ${S.ayarlar.bildirimAktif?'btn-primary':'btn-outline'}" ${notificationDurumu()==='insecure'||notificationDurumu()==='unsupported'?'disabled':''} ${dClick('bildirimIzniSor')}>${
        S.ayarlar.bildirimAktif ? 'Aktif — Kapat' : 'Bildirimleri Aç'
      }</button></div>
  </div></div>`;

  const birimHtml = `<div class="card"><div class="card-header"><i data-lucide="ruler" class="icon-inline"></i> Birimler</div><div class="card-body">
    <div class="birim-tag-list">
      ${S.ayarlar.birimler.map(b=>`<span class="birim-tag">${esc(b)}<button ${dClick('birimSil',b)} title="Sil"><i data-lucide="x"></i></button></span>`).join('')}
    </div>
    <div class="ayar-add-row">
      <input type="text" id="yeni-birim-inp" placeholder="Yeni birim..." class="ayar-input-sm" maxlength="20" ${dKeydown('birimEkle','Enter')}>
      <button class="btn btn-sm btn-outline" ${dClick('birimEkle')}><i data-lucide="plus" class="icon-inline"></i> Ekle</button>
    </div>
  </div></div>`;

  const depoHtml = `<div class="card"><div class="card-header"><i data-lucide="warehouse" class="icon-inline"></i> Depolar</div><div class="card-body">
    ${Object.entries(DEPO_META).map(([ad,m])=>`
      <div class="ayar-row" id="depo-row-${CSS.escape(ad)}">
        <div class="ayar-label"><span class="badge" style="background:${m.color}22;color:${m.color};margin-right:6px">${esc(m.kod)}</span>${esc(ad)}</div>
        <button class="btn btn-sm btn-outline" ${dClick('depoYeniAdDlg',ad)}><i data-lucide="pencil" class="icon-inline"></i> Düzenle</button>
      </div>`).join('')}
    <div id="depo-yeniad-form"></div>
    <div class="ayar-subsection">
      <div class="ayar-section-title">Yeni Depo Ekle</div>
      <div class="ayar-add-row">
        <input type="text" id="yd-ad" placeholder="Depo adı" class="ayar-input-md" maxlength="40">
        <input type="text" id="yd-kod" placeholder="Kod (2-3 harf)" class="ayar-input-sm" maxlength="4">
        <input type="color" id="yd-renk" value="#546e7a" class="ayar-color-inp">
        <button class="btn btn-sm btn-primary" ${dClick('ekDepoEkle')}><i data-lucide="plus" class="icon-inline"></i> Ekle</button>
      </div>
    </div>
  </div></div>`;

  const katHtml = `<div class="card"><div class="card-header"><i data-lucide="tags" class="icon-inline"></i> Kategoriler</div><div class="card-body">
    ${Object.entries(KAT_COLORS).map(([ad])=>`
      <div class="ayar-row">
        <div class="ayar-label">${window.katBadgeHTML(ad)}</div>
        <button class="btn btn-sm btn-outline" ${dClick('katYeniAdDlg',ad)}><i data-lucide="pencil" class="icon-inline"></i> Düzenle</button>
      </div>`).join('')}
    <div id="kat-yeniad-form"></div>
    <div class="ayar-subsection">
      <div class="ayar-section-title">Yeni Kategori Ekle</div>
      <div class="ayar-add-row">
        <input type="text" id="yk-ad" placeholder="Kategori adı" class="ayar-input-md" maxlength="40">
        <input type="color" id="yk-renk-c" value="#546e7a" class="ayar-color-inp" title="Yazı rengi">
        <input type="color" id="yk-renk-bg" value="#eceff1" class="ayar-color-inp" title="Arkaplan rengi">
        <button class="btn btn-sm btn-primary" ${dClick('ekKatEkle')}><i data-lucide="plus" class="icon-inline"></i> Ekle</button>
      </div>
    </div>
  </div></div>`;

  const talepAyarHtml = `<div class="card"><div class="card-header"><i data-lucide="file-text" class="icon-inline"></i> Talepname Ayarları</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">Talep no ön eki<small>Örn. TLN → TLN-0001</small></div>
      <input type="text" class="ayar-input-sm" maxlength="8" value="${S.ayarlar.talepOnPek||'TLN'}" ${dChange('setAyarTalepOnPek')} style="text-transform:uppercase"></div>
    <div class="ayar-row"><div class="ayar-label">Talep eden (varsayılan)<small>Talepname açılınca otomatik dolar</small></div>
      <input type="text" class="ayar-input-md" maxlength="60" placeholder="Ad Soyad..." value="${esc(S.ayarlar.talepSahibi||'')}" ${dChange('setAyarTrim','talepSahibi')}></div>
    <div class="ayar-row"><div class="ayar-label">Onaylayan 1</div>
      <input type="text" class="ayar-input-md" maxlength="60" placeholder="Ad Unvan..." value="${esc(S.ayarlar.talepOnaylayan1||'')}" ${dChange('setAyarTrim','talepOnaylayan1')}></div>
    <div class="ayar-row"><div class="ayar-label">Onaylayan 2</div>
      <input type="text" class="ayar-input-md" maxlength="60" placeholder="Ad Unvan..." value="${esc(S.ayarlar.talepOnaylayan2||'')}" ${dChange('setAyarTrim','talepOnaylayan2')}></div>
    <div class="ayar-row"><div class="ayar-label">Onaylayan Amir (imza 3)</div>
      <input type="text" class="ayar-input-md" maxlength="60" placeholder="Ad Unvan..." value="${esc(S.ayarlar.talepOnaylayan3||'')}" ${dChange('setAyarTrim','talepOnaylayan3')}></div>
  </div></div>`;

  const veriHtml = `<div class="card"><div class="card-header"><i data-lucide="rotate-ccw" class="icon-inline"></i> Sıfırlama</div><div class="card-body">
    <div class="ayar-row"><div class="ayar-label">Stok sütun sırası & görünürlük<small>Sürükle-bırak ile değiştirilen sütun düzenini sıfırla</small></div>
      <button class="btn btn-sm btn-outline" ${dClick('stokSutunSifirla')}>Sıfırla</button></div>
    <div class="ayar-row"><div class="ayar-label">Tüm ayarları sıfırla<small>Fabrika ayarlarına dön</small></div>
      <button class="btn btn-sm btn-outline" ${dClick('tumAyarlariSifirla')}>Sıfırla</button></div>
  </div></div>`;

  const panels = {
    genel:    kurumHtml + temaHtml,
    esik:     esikHtml,
    birim:    birimHtml,
    depo:     depoHtml,
    kategori: katHtml,
    talep:    talepAyarHtml,
    sifirla:  veriHtml,
  };
  const tabs = [
    { id:'genel',    icon:'sliders-horizontal', label:'Genel' },
    { id:'esik',     icon:'gauge',              label:'Eşik & Limitler' },
    { id:'birim',    icon:'ruler',              label:'Birimler' },
    { id:'depo',     icon:'warehouse',          label:'Depolar' },
    { id:'kategori', icon:'tags',               label:'Kategoriler' },
    { id:'talep',    icon:'file-text',          label:'Talepname' },
    { id:'sifirla',  icon:'rotate-ccw',         label:'Sıfırlama' },
  ];
  if (!panels[S.ayarlarAktifTab]) S.ayarlarAktifTab = 'genel';

  const terim = (S.ayarlarArama||'').trim();
  const aramaAktif = terim.length > 0;

  const sidebar = `<aside class="ayarlar-nav">
    <div class="ayarlar-search">
      <i data-lucide="search" class="icon-inline"></i>
      <input type="text" id="ayarlar-arama-inp" placeholder="Ayarlarda ara..." value="${esc(terim)}" ${dInput('ayarlarAra')}>
      ${aramaAktif?`<button class="ayarlar-search-clear" ${dClick('ayarlarAraTemizle')} title="Aramayı temizle"><i data-lucide="x"></i></button>`:''}
    </div>
    <nav class="ayarlar-nav-list">
      ${tabs.map(t => `<button class="ayar-nav-btn ${!aramaAktif && S.ayarlarAktifTab===t.id?'active':''}" ${dClick('setAyarlarTab',t.id)}><i data-lucide="${t.icon}" class="icon-inline"></i><span>${t.label}</span></button>`).join('')}
    </nav>
  </aside>`;

  const icerik = aramaAktif
    ? Object.values(panels).join('')
    : (panels[S.ayarlarAktifTab] || panels.genel);

  el.innerHTML = sidebar + `<section class="ayarlar-panel" id="ayarlar-panel-icerik">${icerik}</section>`;

  if (aramaAktif) _ayarlarAramaFiltre(terim);
  if (window.lucide && lucide.createIcons) lucide.createIcons();
  const inp = document.getElementById('ayarlar-arama-inp');
  if (inp && aramaAktif) {
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}

export function birimEkle() {
  const inp = document.getElementById('yeni-birim-inp') || document.getElementById('yeni-birim-ekle');
  const val = (inp?.value||'').trim();
  if (!val) { inp?.focus(); return; }
  if (S.ayarlar.birimler.includes(val)) { window.toast('Bu birim zaten var','error'); inp?.focus(); return; }
  S.ayarlar.birimler.push(val);
  ayarlariKaydet(); window.initBirimSelects(); inp.value=''; renderAyarlar();
  window.toast(val + ' eklendi ✓');
}

export function birimSil(b) {
  const i = typeof b === 'number' ? b : S.ayarlar.birimler.indexOf(b);
  if (i < 0) return;
  if (!confirm(`"${S.ayarlar.birimler[i]}" birimini silmek istediğinizden emin misiniz?`)) return;
  S.ayarlar.birimler.splice(i,1);
  ayarlariKaydet(); window.initBirimSelects(); renderAyarlar();
}

export function ekDepoEkle() {
  const ad    = (document.getElementById('yd-ad')?.value||'').trim();
  const kod   = (document.getElementById('yd-kod')?.value||'').trim().toUpperCase();
  const color = document.getElementById('yd-renk')?.value||'#546e7a';
  let ok = true;
  if (!ad)  { setFieldError('yd-ad',  'Depo adı zorunlu'); ok = false; }
  if (!kod) { setFieldError('yd-kod', 'Kod zorunlu');      ok = false; }
  if (ok && DEPO_META[ad]) { setFieldError('yd-ad', 'Bu isimde depo zaten var'); ok = false; }
  if (!ok) { document.querySelector('.field--error input')?.focus(); return; }
  if (!S.ayarlar.ekDepo) S.ayarlar.ekDepo=[];
  S.ayarlar.ekDepo.push({ad,kod,color});
  DEPO_META[ad]={kod,cls:'',color}; DEPO_BADGE[ad]='';
  ayarlariKaydet(); window.initDepoSelects(); renderAyarlar();
  window.toast(ad+' eklendi ✓');
}

export function depoYeniAdDlg(eskiAd) {
  const m = DEPO_META[eskiAd]; if(!m) return;
  const form = document.getElementById('depo-yeniad-form'); if(!form) return;
  form.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding:10px;background:var(--bg);border-radius:8px">
    <strong style="width:100%;font-size:12px;margin-bottom:4px">${esc(eskiAd)} düzenle</strong>
    <input type="text" id="dyn-ad" value="${esc(eskiAd)}" placeholder="Depo adı" class="ayar-input" style="max-width:160px">
    <input type="text" id="dyn-kod" value="${esc(m.kod)}" maxlength="4" placeholder="Kod" class="ayar-input" style="max-width:80px">
    <input type="color" id="dyn-renk" value="${m.color}" style="width:38px;height:32px;padding:2px;border:1px solid var(--line);border-radius:6px;cursor:pointer">
    <button class="btn btn-sm btn-primary" ${dClick('depoYeniAdKaydet',eskiAd)}><i data-lucide="check" class="icon-inline"></i> Kaydet</button>
    <button class="btn btn-sm btn-outline" ${dClick('renderAyarlar')} title="İptal"><i data-lucide="x"></i></button>
  </div>`;
}

export function depoYeniAdKaydet(eskiAd) {
  const yeniAd   = (document.getElementById('dyn-ad')?.value||'').trim();
  const yeniKod  = (document.getElementById('dyn-kod')?.value||'').trim().toUpperCase();
  const yeniRenk = document.getElementById('dyn-renk')?.value || DEPO_META[eskiAd]?.color;
  if(!yeniAd||!yeniKod){window.toast('Ad ve kod zorunlu','error');return;}
  if(yeniAd!==eskiAd&&DEPO_META[yeniAd]){window.toast('Bu depo adı zaten var','error');return;}
  const meta = { ...DEPO_META[eskiAd], kod:yeniKod, color:yeniRenk };
  delete DEPO_META[eskiAd]; DEPO_META[yeniAd] = meta;
  const badge = DEPO_BADGE[eskiAd]; delete DEPO_BADGE[eskiAd]; DEPO_BADGE[yeniAd] = badge||'';
  if(yeniAd !== eskiAd) {
    const prefix = eskiAd+'||'; const yeniPrefix = yeniAd+'||';
    const renameObj = obj => { Object.keys(obj).filter(k=>k.startsWith(prefix)).forEach(k=>{ obj[yeniPrefix+k.slice(prefix.length)]=obj[k]; delete obj[k]; }); };
    renameObj(S.stok); renameObj(S.ozelMalzeme); renameObj(S.silinmis); renameObj(S.malzemeMeta);
    apiFetch(API_URL + '?action=hareket_depo_guncelle', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ eskiDepo: eskiAd, yeniDepo: yeniAd }),
    }).catch(e => console.warn('Hareket depo güncelleme:', e));
    const ekD = (S.ayarlar.ekDepo||[]).find(d=>d.ad===eskiAd); if(ekD) ekD.ad=yeniAd;
    if(!S.ayarlar.depoYeniadlar) S.ayarlar.depoYeniadlar={};
    const origKey = Object.entries(S.ayarlar.depoYeniadlar||{}).find(([,v])=>v===eskiAd)?.[0] || eskiAd;
    if(origKey!==yeniAd) S.ayarlar.depoYeniadlar[origKey]=yeniAd; else delete S.ayarlar.depoYeniadlar[origKey];
  }
  ayarlariKaydet(); window.apiSave(); window.initDepoSelects(); renderAyarlar();
  window.toast(yeniAd+' güncellendi ✓');
}

export function ekKatEkle() {
  const ad  = (document.getElementById('yk-ad')?.value||'').trim();
  const c   = document.getElementById('yk-renk-c')?.value||'#546e7a';
  const bg  = document.getElementById('yk-renk-bg')?.value||'#eceff1';
  if (!ad)            { setFieldError('yk-ad', 'Kategori adı zorunlu');     document.getElementById('yk-ad')?.focus(); return; }
  if (KAT_COLORS[ad]) { setFieldError('yk-ad', 'Bu kategori zaten var');    document.getElementById('yk-ad')?.focus(); return; }
  if (!S.ayarlar.ekKategori) S.ayarlar.ekKategori=[];
  S.ayarlar.ekKategori.push({ad,c,bg});
  KAT_COLORS[ad]={c,bg};
  ayarlariKaydet(); window.initKatSelects(); renderAyarlar();
  window.toast(ad+' eklendi ✓');
}

export function katYeniAdDlg(eskiAd) {
  const cc = KAT_COLORS[eskiAd]; if(!cc) return;
  const form = document.getElementById('kat-yeniad-form'); if(!form) return;
  form.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding:10px;background:var(--bg);border-radius:8px">
    <strong style="width:100%;font-size:12px;margin-bottom:4px">${esc(eskiAd)} düzenle</strong>
    <input type="text" id="kyn-ad" value="${esc(eskiAd)}" placeholder="Kategori adı" class="ayar-input" style="max-width:160px">
    <input type="color" id="kyn-c" value="${cc.c}" style="width:38px;height:32px;padding:2px;border:1px solid var(--line);border-radius:6px;cursor:pointer" title="Yazı rengi">
    <input type="color" id="kyn-bg" value="${cc.bg}" style="width:38px;height:32px;padding:2px;border:1px solid var(--line);border-radius:6px;cursor:pointer" title="Arkaplan">
    <button class="btn btn-sm btn-primary" ${dClick('katYeniAdKaydet',eskiAd)}><i data-lucide="check" class="icon-inline"></i> Kaydet</button>
    <button class="btn btn-sm btn-outline" ${dClick('renderAyarlar')} title="İptal"><i data-lucide="x"></i></button>
  </div>`;
}

export function katYeniAdKaydet(eskiAd) {
  const yeniAd = (document.getElementById('kyn-ad')?.value||'').trim();
  const yeniC  = document.getElementById('kyn-c')?.value || KAT_COLORS[eskiAd]?.c;
  const yeniBg = document.getElementById('kyn-bg')?.value || KAT_COLORS[eskiAd]?.bg;
  if(!yeniAd){window.toast('Kategori adı zorunlu','error');return;}
  if(yeniAd!==eskiAd&&KAT_COLORS[yeniAd]){window.toast('Bu kategori zaten var','error');return;}
  delete KAT_COLORS[eskiAd]; KAT_COLORS[yeniAd]={c:yeniC,bg:yeniBg};
  const ekK = (S.ayarlar.ekKategori||[]).find(k=>k.ad===eskiAd); if(ekK) ekK.ad=yeniAd;
  if(!S.ayarlar.katYeniadlar) S.ayarlar.katYeniadlar={};
  const origKey = Object.entries(S.ayarlar.katYeniadlar||{}).find(([,v])=>v===eskiAd)?.[0] || eskiAd;
  if(origKey!==yeniAd) S.ayarlar.katYeniadlar[origKey]=yeniAd; else delete S.ayarlar.katYeniadlar[origKey];
  ayarlariKaydet(); window.initKatSelects(); renderAyarlar();
  window.toast(yeniAd+' güncellendi ✓');
}

export function veriSifirla() {
  if (!confirm('Tüm stok, hareket ve özel malzeme verileri silinecek.\nDevam etmek istediğinizden emin misiniz?')) return;
  S.stok={}; S.ozelMalzeme={}; S.silinmis={}; S.malzemeMeta={};
  window.apiReset();
  window.refreshAll();
  window.refreshVeriYonet();
  window.toast('Tüm veriler sıfırlandı.');
}

// Expose on window for inline handlers
window.setAyar = setAyar;
window.setTema = setTema;
window.setAyarlarTab = setAyarlarTab;
window.ayarlarAraOlay = ayarlarAraOlay;
window.renderAyarlar = renderAyarlar;
window.birimEkle = birimEkle;
window.birimSil = birimSil;
window.ekDepoEkle = ekDepoEkle;
window.depoYeniAdDlg = depoYeniAdDlg;
window.depoYeniAdKaydet = depoYeniAdKaydet;
window.ekKatEkle = ekKatEkle;
window.katYeniAdDlg = katYeniAdDlg;
window.katYeniAdKaydet = katYeniAdKaydet;
window.veriSifirla = veriSifirla;
window.ayarlariKaydet = ayarlariKaydet;
window.applyTheme = applyTheme;
