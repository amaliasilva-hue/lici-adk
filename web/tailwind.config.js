/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
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
