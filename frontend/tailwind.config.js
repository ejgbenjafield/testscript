/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Schibsted Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: { DEFAULT: '#18212F', soft: '#3A4456', muted: '#5B6576', faint: '#8A94A3' },
        canvas: '#F3F5F8',
        line: { DEFAULT: '#D9DEE5', strong: '#B9C1CC' },
        cobalt: { 50: '#EEF1FC', 100: '#DCE3FA', 500: '#3A57D6', 600: '#2B4ACB', 700: '#213BA6' },
        pass: { DEFAULT: '#1E8A52', soft: '#E3F4EA' },
        fail: { DEFAULT: '#C93A2B', soft: '#FBE7E4' },
        skip: { DEFAULT: '#A47E12', soft: '#FBF2D9' },
        untested: { DEFAULT: '#C5CCD6', soft: '#EEF1F4' },
      },
      fontSize: {
        // A modular scale (≈1.2) for UI text.
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.3rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.2rem', { lineHeight: '1.65rem' }],
        xl: ['1.44rem', { lineHeight: '1.9rem' }],
        '2xl': ['1.728rem', { lineHeight: '2.2rem' }],
        '3xl': ['2.074rem', { lineHeight: '2.5rem' }],
      },
    },
  },
  plugins: [],
};
