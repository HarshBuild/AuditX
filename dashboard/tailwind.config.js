/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary brand — indigo (spec: #4F46E5 family)
        brand: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#4F46E5',
          600: '#4338CA',
          700: '#3730A3',
          800: '#312E81',
          900: '#1E1B4B',
          950: '#171239',
        },
        // Secondary accent — electric blue (used sparingly: glows, sidebar accents)
        accent: {
          300: '#93BBFF',
          400: '#5B93FF',
          500: '#2F7BFF',
          600: '#2563EB',
          700: '#1B4FD8',
        },
        // Dark-mode neutral surfaces (spec dark tokens)
        navy: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#2A3547',
          900: '#172033',
          950: '#0B0F19',
        },
        // Deepest app-shell black-navy
        ink: {
          DEFAULT: '#070D1D',
        },
        // Light-mode neutral surfaces (spec light tokens)
        surface: {
          DEFAULT: '#FFFFFF',
          secondary: '#F9FAFB',
          bg: '#F7F8FC',
        },
        line: {
          DEFAULT: '#E5E7EB',
          strong: '#D1D5DB',
        },
        'ink-text': {
          DEFAULT: '#111827',
          soft: '#6B7280',
          faint: '#9CA3AF',
        },
        // Semantic status colors (spec)
        success: {
          50: '#F0FDF4',
          100: '#DCFCE7',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
        },
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
        },
        danger: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
        },
        info: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Noto Sans Devanagari', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.01em' }],
      },
      borderRadius: {
        control: '8px',
        field: '10px',
        card: '14px',
        modal: '20px',
        hero: '24px',
      },
      boxShadow: {
        // soft elevation scale
        xs: '0 1px 2px 0 rgb(17 24 39 / 0.04)',
        sm: '0 1px 3px 0 rgb(17 24 39 / 0.05), 0 1px 2px -1px rgb(17 24 39 / 0.04)',
        md: '0 4px 10px -2px rgb(17 24 39 / 0.06), 0 2px 6px -2px rgb(17 24 39 / 0.05)',
        lg: '0 12px 28px -8px rgb(17 24 39 / 0.14)',
        'overlay-lg': '0 32px 64px -12px rgb(11 19 36 / 0.35)',
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        lifted: '0 4px 6px -1px rgb(15 23 42 / 0.06), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
        'inset-top': 'inset 0 1px 0 rgb(255 255 255 / 0.12)',
        glow: '0 0 0 1px rgb(79 70 229 / 0.15), 0 8px 30px -6px rgb(67 56 202 / 0.35)',
        'glow-sm': '0 0 0 1px rgb(79 70 229 / 0.12), 0 4px 14px -2px rgb(67 56 202 / 0.3)',
        'glow-lg': '0 0 0 1px rgb(79 70 229 / 0.2), 0 12px 44px -8px rgb(67 56 202 / 0.45)',
        'navy-lg': '0 16px 48px -12px rgb(11 19 36 / 0.45)',
        bar: '0 1px 10px rgb(129 140 248 / 0.55)',
        'bar-lg': '0 0 10px rgb(129 140 248 / 0.45)',
      },
      zIndex: {
        header: '30',
        dropdown: '40',
        overlay: '50',
        modal: '60',
        toast: '70',
        pwa: '80',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'drawer-in': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'page-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        'scan-line': {
          '0%': { top: '0%', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '100%': { top: '100%', opacity: '0' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(79 70 229 / 0.45)' },
          '50%': { boxShadow: '0 0 0 10px rgb(79 70 229 / 0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'gauge-fill': {
          from: { strokeDashoffset: 'var(--gauge-offset-start, 289.6)' },
          to: { strokeDashoffset: 'var(--gauge-offset-end, 0)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-in': 'slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'toast-in': 'toast-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'drawer-in': 'drawer-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'page-in': 'page-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
        'scan-line': 'scan-line 2.2s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2.2s ease-in-out infinite',
        float: 'float 5s ease-in-out infinite',
        'spin-slow': 'spin-slow 8s linear infinite',
        'gauge-fill': 'gauge-fill 1s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'scan-line-progress': 'scan-line 1.2s ease-in-out infinite',
        'fade-up': 'fade-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
}