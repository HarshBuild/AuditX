/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#4f9bff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        accent: {
          300: '#7ab8ff',
          400: '#4f9bff',
          500: '#2f7bff',
          600: '#2563eb',
          700: '#1b4fd8',
        },
        navy: {
          50: '#f3f6fb',
          100: '#e0e8f4',
          200: '#c3d2e9',
          300: '#9bb2d8',
          400: '#6b8bc1',
          500: '#4a6ca8',
          600: '#39568c',
          700: '#2f4672',
          800: '#223352',
          900: '#16223c',
          950: '#0b1324',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Noto Sans Devanagari', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        lifted: '0 4px 6px -1px rgb(15 23 42 / 0.06), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
        glow: '0 0 0 1px rgb(59 130 246 / 0.15), 0 8px 30px -6px rgb(37 99 235 / 0.35)',
        'glow-sm': '0 0 0 1px rgb(59 130 246 / 0.12), 0 4px 14px -2px rgb(37 99 235 / 0.3)',
        'glow-lg': '0 0 0 1px rgb(59 130 246 / 0.2), 0 12px 44px -8px rgb(37 99 235 / 0.45)',
        'navy-lg': '0 16px 48px -12px rgb(11 19 36 / 0.45)',
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
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(37 99 235 / 0.45)' },
          '50%': { boxShadow: '0 0 0 10px rgb(37 99 235 / 0)' },
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
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        lifted: '0 4px 6px -1px rgb(15 23 42 / 0.06), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
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
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'drawer-in': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-in': 'slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'toast-in': 'toast-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'drawer-in': 'drawer-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}