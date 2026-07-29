import { defineConfig, presetWind3, transformerDirectives } from 'unocss'

export default defineConfig({
  presets: [presetWind3()],
  content: {
    pipeline: {
      exclude: ['node_modules']
    }
  },
  safelist: [],
  transformers: [
    transformerDirectives() // 启用指令转换器
  ]
})
