import js from '@eslint/js';
export default [{
  ...js.configs.recommended,
  files:['**/*.mjs'],
  languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{AbortSignal:'readonly',Buffer:'readonly',URL:'readonly',fetch:'readonly',process:'readonly',console:'readonly'}},
}];
