/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Override Tailwind's default slate scale so light grays read with
        // adequate contrast on white surfaces (WCAG AA, ≥ 4.5:1).
        // Each shade is shifted ~one step darker than the Tailwind default.
        slate: {
          50:  '#F8FAFC',
          100: '#EEF2F7',
          200: '#D9E0EA',
          300: '#94A3B8', // was #CBD5E1 → now matches old slate-400
          400: '#64748B', // was #94A3B8 → now matches old slate-500
          500: '#475569', // was #64748B → now matches old slate-600
          600: '#334155', // was #475569
          700: '#1E293B', // was #334155
          800: '#0F172A', // was #1E293B
          900: '#020617',
        },
        navy: {
          DEFAULT: '#14263D',
          900: '#0A1320',
          800: '#14263D',
          700: '#1C3555',
          600: '#25446E',
        },
        primary:  '#047EA9',
        'primary-light': '#00BEFF',
        'green-accent':  '#C0FF7D',
        'pink-accent':   '#FF89FF',
        danger:   '#E14849',
        surface:  '#1B3351',
        'surface-2': '#243D57',
        brand: {
          primary:      '#047EA9',
          primaryLight: '#00BEFF',
          primaryPale:  '#EBFAFF',
          green:        '#7FA856',
          greenLight:   '#C0FF7D',
          greenPale:    '#FAFFF5',
          pink:         '#A85CA9',
          pinkLight:    '#FF89FF',
          red:          '#E14849',
          orange:       '#F59E0B',
        },
      },
      fontFamily: {
        poppins: ['var(--font-poppins)', 'Poppins', 'sans-serif'],
        roboto:  ['var(--font-roboto)',  'Roboto',  'sans-serif'],
        mono:    ['Roboto Mono', 'monospace'],
      },
      screens: {
        '2xl': '1536px',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
