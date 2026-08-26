import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // alpha-black tokens per spec_ui §3.2
        "alpha-5": "rgb(0 0 0 / 5%)",
        "alpha-9": "rgb(0 0 0 / 9%)",
        "alpha-10": "rgb(0 0 0 / 10%)",
        "alpha-18": "rgb(0 0 0 / 18%)",
        "alpha-44": "rgb(0 0 0 / 44%)",
        "alpha-64": "rgb(0 0 0 / 64%)",
      },
      borderRadius: {
        lg: "8px",
        md: "8px",
        sm: "6px",
      },
      spacing: {
        // 8px base rhythm; Tailwind default 1 = 4px, so 2 = 8px already
        // explicit semantic tokens
        "sidebar": "240px",
        "topbar": "48px",
      },
      fontFamily: {
        sans: ["Geist", "Inter Variable", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
      maxWidth: {
        dashboard: "1280px",
      },
    },
  },
  plugins: [],
} satisfies Config;
