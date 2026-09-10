import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      ink: { 800:'#1a1a1d', 900:'#101012', 950:'#0a0a0b' },
      brand: { 50:'#fef2f2',100:'#fde3e3',500:'#dc3b3b',600:'#c62222',700:'#a51b1b' },
      gold: { 500:'#d4a72c' }
    }
  }},
  plugins: [],
}
export default config
