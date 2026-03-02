/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        up: '#ff4d4f',
        down: '#52c41a',
        flat: '#8c8c8c',
        primary: {
          DEFAULT: '#1890ff',
          hover: '#40a9ff',
          light: '#69c0ff',
          dark: '#096dd9',
        },
        secondary: '#722ed1',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
