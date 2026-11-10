/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--color-ink)',
        muted: 'var(--color-muted)',
        border: 'var(--color-border)',
        canvas: 'var(--color-canvas)',
        surface: 'var(--color-surface)',
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: '#1e40af',
        },
        status: {
          green: 'var(--color-green)',
          'green-bg': 'var(--color-green-bg)',
          amber: 'var(--color-amber)',
          'amber-bg': 'var(--color-amber-bg)',
          red: 'var(--color-red)',
          'red-bg': 'var(--color-red-bg)',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

