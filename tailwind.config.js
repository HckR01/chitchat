/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          750: '#253248',
          850: '#141d2e',
          950: '#080c14',
        },
      },
    },
  },
  plugins: [],
}
