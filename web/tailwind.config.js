/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
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
          primary:     '#047EA9',
          primaryLight:'#00BEFF',
          green:       '#7FA856',
          greenLight:  '#C0FF7D',
          pink:        '#A85CA9',
          pinkLight:   '#FF89FF',
          red:         '#E14849',
        },
      },
      fontFamily: {
        poppins: ['var(--font-poppins)', 'Poppins', 'sans-serif'],
        roboto:  ['var(--font-roboto)',  'Roboto',  'sans-serif'],
      },
    },
  },
  plugins: [],
};
