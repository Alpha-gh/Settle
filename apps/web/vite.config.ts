import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: mode === 'mock' ? { 'import.meta.env.VITE_USE_MOCKS': JSON.stringify('true') } : undefined,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@settle/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-ag-charts': ['ag-charts-community', 'ag-charts-react'],
          'vendor-ag-grid': ['ag-grid-community', 'ag-grid-react'],
          'vendor-react': ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          'vendor-radix': ['@radix-ui/react-dialog'],
        },
      },
    },
  },
}));

