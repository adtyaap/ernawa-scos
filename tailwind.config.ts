import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: {
          bg: 'var(--color-bg)',
          panel: 'var(--color-panel)',
          border: 'var(--color-border)',
          text: 'var(--color-text)',
          muted: 'var(--color-muted)',
          accent: 'var(--color-accent)',
          success: 'var(--color-success)',
          danger: 'var(--color-danger)',
          warning: 'var(--color-warning)',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
