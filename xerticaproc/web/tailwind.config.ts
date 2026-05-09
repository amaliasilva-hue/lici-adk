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
        x: {
          "bg-deep":   "#080F1A",
          "bg-1":      "#0B1422",
          "bg-2":      "#101B2E",
          cyan:        "#00BCD4",
          "cyan-glow": "#3FE3FF",
          blue:        "#1E5FA8",
          "blue-deep": "#14263D",
          green:       "#C0FF7D",
          orange:      "#F39C12",
          red:         "#E74C3C",
          ink:         "#FAFBFC",
          "ink-dim":   "#A8B2C7",
          "ink-mute":  "#6A7790",
          line:        "#1F2C44",
        },
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
          DEFAULT: "#080F1A",
          card: "#101B2E",
          border: "#1F2C44",
        },
        status: {
          confirmado: "#C0FF7D",
          inferido:   "#F0B429",
          pendente:   "#6A7790",
          bloqueante: "#E74C3C",
          dispensado: "#3F4A5F",
        },
      },
      fontFamily: {
        sans:    ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-poppins)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xs: "4px", sm: "6px", md: "10px", lg: "14px", xl: "20px", "2xl": "28px",
      },
      boxShadow: {
        "x-glow":  "0 0 24px 0 rgba(0,188,212,0.35)",
        "x-card":  "0 4px 24px -8px rgba(0,0,0,0.45)",
        "x-ring":  "0 0 0 2px rgba(63,227,255,0.55)",
      },
      backgroundImage: {
        "x-grad-cta": "linear-gradient(135deg, #00BCD4 0%, #1E5FA8 100%)",
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        "slide-up": "slideUp 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        "pulse-cyan": "pulseCyan 1.6s ease-in-out infinite",
      },
      keyframes: {
        fadeIn:  { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseCyan: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(63,227,255,0.5)" },
          "50%":      { boxShadow: "0 0 0 6px rgba(63,227,255,0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
