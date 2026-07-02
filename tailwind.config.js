/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/admin/**/*.{html,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: "#090806",
          900: "#12100d",
          850: "#181511",
          800: "#211d18",
          700: "#34302a"
        },
        ambermetal: {
          500: "#d8a84d",
          400: "#e7bd68",
          300: "#f3d993"
        },
        coral: {
          500: "#e46f61",
          400: "#f08a7d"
        }
      },
      boxShadow: {
        panel: "0 18px 60px rgba(0, 0, 0, 0.34)",
        glow: "0 0 0 1px rgba(232, 189, 104, 0.22), 0 16px 48px rgba(216, 168, 77, 0.08)"
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", "Arial", "sans-serif"]
      }
    }
  },
  plugins: []
};
