/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,html}'],
  theme: {
    extend: {
      colors: {
        bg: '#F4F3EE', card: '#FAF9F6', border: '#E6E4DD', text: '#141413',
        muted: '#73726C', accent: '#D97757', accentLight: '#F6E8E3',
        sage: '#3D6B52', sageLight: '#E6F0EA'
      },
      fontFamily: {
        serif: ['Newsreader', 'Georgia', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif']
      }
    }
  }
};
