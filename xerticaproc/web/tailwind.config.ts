import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Xertica brand palette
        brand: {
          navy: "#14263D",
          "navy-light": "#1B334F",
          blue: "#1E5FA8",
          cyan: "#00BCD4",
          green: "#2ECC71",
          orange: "#F39C12",
          red: "#E74C3C",
        },
        surface: {
          DEFAULT: "#0F1F31",
          card: "#16293D",
          border: "#1E3550",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-poppins)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
