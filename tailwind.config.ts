import type { Config } from 'tailwindcss';

const token = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Tipografi mengikuti Stitch "Web ERP System Design": Plus Jakarta Sans
      // utk semua teks (judul, isi, label), JetBrains Mono tersedia lewat
      // font-mono utk kode/angka teknis (belum dipaksa ke semua angka KPI --
      // lihat catatan di KPICard). font-display dipertahankan sbg alias.
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // Skala sudut mengikuti style guide Stitch "Marine Modern Corporate":
      // kontrol (tombol/input/badge) 8px, kartu/panel 16px -- lebih bulat
      // drpd Fiori sebelumnya (4px/8px).
      borderRadius: {
        md: '0.5rem',
        lg: '1rem',
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
