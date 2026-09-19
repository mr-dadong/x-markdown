export default {
  plugins: {
    // Tailwind 4 起 PostCSS 插件从 tailwindcss 包拆到 @tailwindcss/postcss。
    '@tailwindcss/postcss': {},
    // 项目自身的 CSS 仍交给 autoprefixer 补前缀。
    autoprefixer: {},
  },
}
