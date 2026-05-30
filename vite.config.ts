/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    // Default env is node; component tests opt into jsdom via the
    // `@vitest-environment jsdom` pragma (see tests/components/*.test.tsx).
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Registers @testing-library/jest-dom matchers on Vitest's `expect`.
    // Safe to load in either env — registration has no DOM-side effects.
    setupFiles: ['tests/setup-rtl.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/components/**/*.{ts,tsx}'],
      reporter: ['text', 'html'],
    },
  },
})
