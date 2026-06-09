import { S } from './state.js';

// ═══════════════════════════════════════════════════════════════════
// i18n — S11 (Faz 1: altyapı + navigasyon kabuğu)
// ───────────────────────────────────────────────────────────────────
// Kanonik dil TR; EN opt-in. Çözüm zinciri: aktif dil → TR → key.
// Böylece kapsanmayan string'ler TR'ye düşer → varsayılanda sıfır regresyon.
//
// Kullanım:
//   - HTML/JS: t('nav.stok')  veya  t('msg.kayit', {n: 5})
//   - Statik DOM: <span data-i18n="nav.stok"></span>
//                 <input data-i18n-ph="ara.placeholder">      (placeholder)
//                 <button data-i18n-title="ipucu.kaydet">     (title)
//   - applyI18n(root) bu attribute'leri doldurur (init + observer'da).
// ═══════════════════════════════════════════════════════════════════

const DICTS = {};            // { tr: {...}, en: {...} }
export const DESTEKLENEN_DILLER = ['tr', 'en'];
let LANG = 'tr';

export function getLang() { return LANG; }

// Sözlükleri /i18n/*.json'dan yükle (same-origin, CSP-OK).
export async function initI18n() {
  await Promise.all(DESTEKLENEN_DILLER.map(async lang => {
    try {
      const r = await fetch(`i18n/${lang}.json`);
      if (r.ok) DICTS[lang] = await r.json();
    } catch (e) { console.warn('i18n yüklenemedi:', lang, e); }
  }));
  LANG = DESTEKLENEN_DILLER.includes(S.ayarlar?.dil) ? S.ayarlar.dil : 'tr';
  document.documentElement.lang = LANG;
  applyI18n(document);
}

// Çeviri: aktif dil → TR → key. {param} interpolasyonu destekler.
export function t(key, vars) {
  let s = DICTS[LANG]?.[key] ?? DICTS.tr?.[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

// Statik DOM'daki data-i18n* attribute'lerini doldur.
export function applyI18n(root = document) {
  if (!root || !root.querySelectorAll) return;
  const scan = (sel, fn) => {
    root.querySelectorAll(sel).forEach(fn);
    if (root.nodeType === 1 && root.matches?.(sel)) fn(root);
  };
  scan('[data-i18n]',        el => { el.textContent = t(el.getAttribute('data-i18n')); });
  scan('[data-i18n-ph]',     el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
  scan('[data-i18n-title]',  el => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
}

// Dili değiştir: kalıcı kaydet, statik DOM'u çevir, aktif sayfayı yeniden render et.
export function setLang(lang) {
  if (!DESTEKLENEN_DILLER.includes(lang)) return;
  LANG = lang;
  S.ayarlar.dil = lang;
  document.documentElement.lang = lang;
  window.ayarlariKaydet?.();
  applyI18n(document);
  // JS ile üretilen içerik (topbar başlığı, sayfa render'ları) tazelensin
  window.navigate?.(S.aktifSayfa || 'dashboard');
  window.renderAyarlar?.();
  if (window.lucide) setTimeout(() => lucide.createIcons(), 30);
}
