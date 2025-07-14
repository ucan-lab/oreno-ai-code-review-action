const js = require('@eslint/js');
const ts = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: [
      'node_modules',
      'dist',
      'coverage',
      '*.js',
      '*.json',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': ts,
      prettier: require('eslint-plugin-prettier'),
    },
    rules: {
      ...ts.configs['recommended'].rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
