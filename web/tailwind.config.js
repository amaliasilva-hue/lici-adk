/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy:     '#14263D',
        primary:  '#047EA9',
        'primary-light': '#00BEFF',
        'green-accent':  '#C0FF7D',
        'pink-accent':   '#FF89FF',
        danger:   '#E14849',
        'surface':  '#1B3351',
        'surface-2':'#243D57',
      },
      fontFamily: {
        poppins: ['var(--font-poppins)', 'Poppins', 'sans-serif'],
        roboto:  ['var(--font-roboto)',  'Roboto',  'sans-serif'],
      },
    },
  },
  plugins: [],
};
