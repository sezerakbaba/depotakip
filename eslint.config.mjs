// ESLint flat config (S8). Gerçek hataları yakalamaya odaklı; biçim
// Prettier'a bırakıldı. Üç dosya grubu: tarayıcı modülleri, CommonJS
// sunucu, ESM build/test betikleri.
import js from '@eslint/js';
import globals from 'globals';

const relaxed = {
  // Kullanılmayan değişken/argümanlar: '_' öneki kasıtlı (örn. _el, _key).
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
};

export default [
  { ignores: ['public/vendor/**', 'public/dist/**', 'node_modules/**'] },

  // Tarayıcı tarafı ES modülleri
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        Chart: 'readonly',   // vendor/chart.umd.min.js
        lucide: 'readonly',  // vendor/lucide.min.js
        XLSX: 'readonly',    // vendor/xlsx.full.min.js (Excel export'ta lazy-load)
      },
    },
    rules: { ...js.configs.recommended.rules, ...relaxed },
  },

  // CommonJS sunucu
  {
    files: ['server.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules, ...relaxed },
  },

  // ESM build/test betikleri
  {
    files: ['build.mjs', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules, ...relaxed },
  },
];
