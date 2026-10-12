/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./web/index.html", "./web/app.js", "./web/src/app.js"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#009E60",
          hover: "#00804D",
        },
      },
    },
  },
  plugins: [],
};
