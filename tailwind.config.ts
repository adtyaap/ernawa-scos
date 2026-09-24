import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Dipakai HomePage ("Control Tower") mengikuti tipografi artifact
        // "Lobster Trading Control Tower" — Fraunces utk judul, IBM Plex
        // Mono (menggantikan default font-mono, tidak ada pemakaian lain
        // yang bergantung pada stack default sebelumnya) utk angka KPI.
        display: ['Fraunces', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
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
