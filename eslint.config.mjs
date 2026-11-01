import js from '@eslint/js'
import parserTs from '@typescript-eslint/parser'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.nuxt/**', '.output/**', '**/.nuxt/**', '**/.output/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parser: parserTs,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest'
      }
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off'
    }
  }
]
