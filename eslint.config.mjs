import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['apps/web/**/*.{ts,tsx}'], plugins: { 'jsx-a11y': jsxA11y }, rules: { ...jsxA11y.configs.strict.rules } },
  { rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] } },
  { ignores: ['**/dist/**', '**/.next/**', '**/generated/**'] },
);
