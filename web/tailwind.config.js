/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        xertica: {
          50: '#eef4ff',
          100: '#dbe5ff',
          500: '#3b5bdb',
          600: '#2f49b3',
          700: '#26397f',
          900: '#0f1a3a',
        },
      },
    },
  },
  plugins: [],
};
