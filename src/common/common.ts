import { IIconProps } from '@icon-park/react/lib/runtime'

/** IconPark 图标默认参数。新代码请改用 TABLER_ICON_INFO —— IconPark 后续会摘除 */
export const ICON_INFO: IIconProps = {
  theme: 'outline',
  size: 20,
  fill: '#333',
  strokeWidth: 3
}

/**
 * Tabler 图标默认参数（ICON_INFO 的 Tabler 版，不依赖 IconPark）
 *
 * 用法：`<IconBrandWindows {...TABLER_ICON_INFO} />`
 *
 * 与 IconPark 的语义对照 —— 颜色和线宽的位置是反的，别套用旧习惯：
 *
 * | 语义 | IconPark          | Tabler                            |
 * | ---- | ----------------- | --------------------------------- |
 * | 颜色 | `fill`            | `color`（默认 currentColor）       |
 * | 线宽 | `strokeWidth`     | `stroke`（默认 2）                 |
 * | 线型 | `theme: 'outline'`| 由图标名决定：`IconXxx` / `IconXxxFilled` |
 *
 * 两个坑：
 * 1. 不要传 `fill`。Tabler 的 `fill` 是 svg 的 fill 属性，线性图标默认
 *    fill="none"，传了会把线性图标填成实心色块 —— 颜色一律走 `color`。
 * 2. Tabler 的 `stroke` 是**线宽**，不是描边颜色。
 *
 * 想让图标跟随主题变色（深色模式）就把 color 改成 `'currentColor'`，
 * 那是 Tabler 的默认值，此刻固定 `#333` 只是为了和 ICON_INFO 保持一致。
 */
export const TABLER_ICON_INFO = {
  size: 20,
  stroke: 2,
  color: '#333'
} as const
