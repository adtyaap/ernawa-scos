import type { Config } from 'tailwindcss';

const token = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Tipografi mengikuti desain Stitch: Inter untuk semua teks (judul,
      // isi, label, angka KPI). font-display dipertahankan sbg alias supaya
      // pemakaian lama tetap valid.
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // Sudut kontrol (input/tombol) lebih tegas spt Fiori; kartu tetap 8px.
      borderRadius: {
        md: '0.25rem',
      },
      colors: {
        app: {
          bg: token('bg'),
          panel: token('panel'),
          border: token('border'),
          text: token('text'),
          muted: token('muted'),
          accent: token('accent'),
          'accent-hover': token('accent-hover'),
          soft: token('soft'),
          'soft-strong': token('soft-strong'),
          success: token('success'),
          danger: token('danger'),
          warning: token('warning'),
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
