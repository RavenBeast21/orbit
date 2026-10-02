import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist` is build output, and `public/ort` is the vendored onnxruntime-web
  // bundle copied in at runtime (see AGENTS.md). Linting those minified
  // vendor files produced thousands of meaningless errors and drowned out
  // real ones — only first-party source under src/ should be linted.
  globalIgnores(['dist', 'public/ort/**', 'public/models/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
