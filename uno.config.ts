import { defineConfig, presetWind4, transformerDirectives } from 'unocss'

export default defineConfig({
  presets: [presetWind4()],
  content: {
    pipeline: {
      exclude: ['node_modules']
    }
  },
  safelist: [],
  transformers: [
    transformerDirectives() // 启用指令转换器
  ],
  theme: {
    colors: {
      on: { brand: 'var(--color-on-brand)' },
      brand: {
        50: 'var(--color-brand-50)',
        100: 'var(--color-brand-100)',
        200: 'var(--color-brand-200)',
        500: 'var(--color-brand-500)',
        600: 'var(--color-brand-600)',
        700: 'var(--color-brand-700)'
      },
      ink: {
        900: 'var(--color-ink-900)',
        700: 'var(--color-ink-700)',
        600: 'var(--color-ink-600)',
        500: 'var(--color-ink-500)',
        400: 'var(--color-ink-400)',
        300: 'var(--color-ink-300)'
      },
      line: {
        200: 'var(--color-line-200)',
        100: 'var(--color-line-100)'
      },
      surface: {
        base: 'var(--color-surface-base)',
        muted: 'var(--color-surface-muted)'
      },
      canvas: 'var(--color-canvas)',
      success: {
        600: 'var(--color-success-600)',
        100: 'var(--color-success-100)'
      },
      danger: {
        600: 'var(--color-danger-600)',
        100: 'var(--color-danger-100)'
      },
      warn: {
        600: 'var(--color-warn-600)',
        100: 'var(--color-warn-100)'
      }
    },
    // 字阶：presetWind4 的字号入口是 theme.text（shape: { fontSize, lineHeight }），
    // 不是 theme.fontSize；值取自 variables.css，保持单一数据源。
    // 注意：theme.text 只产出 font-size / line-height / letter-spacing，
    // 字重需另外叠加 font-{weight} 类。
    // 命名刻意避开 xs/sm/base/lg 等内置档位，避免静默覆盖既有暗色语义。
    // 用法：text-title / text-section / text-card / text-body / text-caption
    text: {
      title: { fontSize: 'var(--font-size-title)', lineHeight: '1.4' },
      section: { fontSize: 'var(--font-size-section)', lineHeight: '1.5' },
      card: { fontSize: 'var(--font-size-card)', lineHeight: '1.5' },
      body: { fontSize: 'var(--font-size-body)', lineHeight: '1.5' },
      caption: { fontSize: 'var(--font-size-caption)', lineHeight: '1.5' }
    },
    // 圆角：presetWind4 的圆角入口是 theme.radius（不是 theme.borderRadius）。
    // 用语义名而非覆盖 sm/md/lg，避免改动既有 rounded-md(11 处) / rounded-lg(6 处) 的观感，
    // 也避免与内置 --radius-md/.375rem、--radius-lg/.5rem 撞名。
    // 用法：rounded-chip(6) / rounded-control(10) / rounded-card(14) / rounded-pill(999)
    //
    // ⚠️ 值必须指向 --radii-*（复数）而不是 --radius-*：presetWind4 会把这里的每个
    // key 原样导出成 --radius-{key}，若值也引用同名变量，产物就成了自引用
    // （--radius-control: var(--radius-control)）—— CSS 里自引用按「计算时无效」处理，
    // border-radius 会静默回落成 0，类名存在但圆角消失，极难排查。
    radius: {
      chip: 'var(--radii-chip)',
      control: 'var(--radii-control)',
      card: 'var(--radii-card)',
      pill: 'var(--radii-pill)'
    }
  }
})
