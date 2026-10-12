import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/types.ts',
        '**/contracts.ts',
        'src/test/**',
        '**/*.test.ts',
        'src/ui/**',
        'src/main.tsx',
      ],
      thresholds: {
        'src/algorithms/**': { branches: 100 },
        'src/model/**': { branches: 90 },
        'src/app/editService.ts': { branches: 90 },
      },
    },
  },
});
