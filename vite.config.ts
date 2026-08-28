import preact from '@preact/preset-vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
