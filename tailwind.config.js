/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Microsoft YaHei',
          'PingFang SC',
          'Hiragino Sans GB',
          'sans-serif',
        ],
        mono: ['SF Mono', 'Fira Code', 'Consolas', 'Menlo', 'monospace'],
      },
      colors: {
        // 组件只使用语义色，具体颜色由白天和夜晚主题变量决定。
        paper: 'var(--color-paper)',
        panel: 'var(--color-panel)',
        toolbar: 'var(--color-toolbar)',
        control: 'var(--color-control)',
        'control-hover': 'var(--color-control-hover)',
        'control-active': 'var(--color-control-active)',
        selected: 'var(--color-selected)',
        ink: 'var(--color-ink)',
        secondary: 'var(--color-secondary)',
        muted: 'var(--color-muted)',
        icon: 'var(--color-icon)',
        folder: 'var(--color-folder)',
        line: 'var(--color-line)',
        accent: 'var(--color-accent)',
        'accent-strong': 'var(--color-accent-strong)',
        link: 'var(--color-link)',
        'link-hover': 'var(--color-link-hover)',
        danger: 'var(--color-danger)',
        inverse: 'var(--color-inverse)',
      },
      spacing: {
        'toolbar': '40px',
        'bottombar': '30px',
        'sidebar-w': '260px',
      },
      fontSize: {
        'menu': '13px',
        'status': '12px',
      },
    },
  },
  plugins: [],
}
