import type { DeviceInfo } from '@/types/discovery'
import {
  defineGlobalState,
  persistMiddleware,
  type ThemeMode
} from 'ono-react-element'

const initialState = {
  theme: 'system' as ThemeMode,
  ip: '',
  port: 0,
  savePath: '',
  version: '0.0.0',
  canUpdate: false,
  autoCheckUpdate: true,
  concurrentUploads: 2, // 同时并发传输的文件数（1-5）
  /* 界面字体与字号缩放（设置页 → 外观）。
   * fontFamily 存的是**可直接写进 CSS font-family 的候选名列表**（如
   * `"微软雅黑", "Microsoft YaHei"`），空串 = 跟随系统 —— 让 JS 在 <html> 上直接取用，
   * 不需要在应用根部再去查一遍字体列表（那份列表只在设置页里加载，根部拿不到）。
   * 用 '' 而不是 null 表示「未自选」：它会被原样塞进 font-family，类型越简单越好，
   * 省掉「null 漏进 CSS 变成 "null" 这个字符串」的可能。 */
  fontFamily: '',
  fontScale: 100, // 百分比，100 = 设计稿原值
  // 设备发现相关
  deviceName: '', // 本机广播别名，空则用默认值
  deviceId: '', // 本机 UUID（启动时由后端读取，不持久化）
  // 对等传输相关（不持久化，每次启动重新分配）
  serverPort: 0, // 本机 TCP 服务端口（应用启动时分配）
  connectedDevice: null as DeviceInfo | null, // 当前连接的对端设备
  // 手机扫码上传相关（不持久化）
  webPort: 0 // 手机上传 HTTP 服务器端口（按需启动时分配）
}

export type StateType = typeof initialState

/* 需要持久化的字段。写成常量而不是两处字面量，是因为下面还要用它做一次
   「值是否可信」的校验 —— 两个列表一旦不同步，校验就会漏掉刚加的那一项。
   字段必须在这里登记，否则只是「改了当场生效、重启就忘」：
   persist 的 properties 是个白名单，漏登记不会报错，只会静默不存。 */
const PERSISTED_KEYS = [
  'theme',
  'version',
  'savePath',
  'canUpdate',
  'deviceName',
  'autoCheckUpdate',
  'concurrentUploads',
  'fontFamily',
  'fontScale'
] as const

export const useStore = defineGlobalState(initialState, [
  persistMiddleware({
    name: 'easy2send',
    properties: [...PERSISTED_KEYS]
  })
])

/** 把 `initialState` 里的默认值写回某项（泛型写法是为了让 `fix[key]` 的类型收敛） */
const restoreDefault = <K extends keyof StateType>(
  key: K,
  target: Partial<StateType>
) => {
  target[key] = initialState[key]
}

/**
 * 持久化数据的**类型复核**。
 *
 * persistMiddleware 的 rehydrate 是按 properties 白名单「按名取值」，再把结果并到初始
 * 状态上 —— **取值不过滤 undefined，也不检查值是不是这一项该有的样子**。于是只要
 * localStorage 里那个键存的是**别的形状**的数据（实测：更早的版本用 zustand/persist 写
 * 过 `{"state":{…},"version":0}` 这种信封，而它和新代码撞在了同一个键名上），白名单里
 * 每一项都会取成 `undefined`，并且**盖掉初始状态的默认值**。
 *
 * 后果不是均匀的：还有第二个来源的字段能自己长回来（theme / savePath / deviceName /
 * concurrentUploads 来自 app.conf.json，version 来自 invoke），而 fontFamily / fontScale
 * 只活在持久化里 ⇒ 永久停在 undefined：
 *   · 设置页在 `value.replace(...)` 上抛错，整页变成 ErrorBoundary；
 *   · useFont 把 `--font-scale` 写成字符串 "NaN"，而 --font-size-* 全是
 *     `calc(Npx * var(--font-scale))` —— 实测 Chrome 会把它们算成 **0px**，
 *     于是整个界面的文字全部不见（这正是「一打开软件文字就没了」）。
 * 而且它是**自锁**的：脏值被原样存回（undefined 还会被 JSON.stringify 丢掉），
 * 下次启动照旧。
 *
 * 判据只取「与默认值同类型」：足够拦下 undefined / null / 数字变成字符串这类污染，
 * 又不会覆盖用户真正设过的合法值。复位后 persistMiddleware 会立刻把干净的全量记录写回，
 * 所以存量安装跑一次就自愈，不需要用户清缓存。
 */
const repairPersisted = () => {
  const state = useStore.getState()
  const fix: Partial<StateType> = {}
  for (const key of PERSISTED_KEYS) {
    if (typeof state[key] !== typeof initialState[key]) {
      restoreDefault(key, fix)
    }
  }
  if (Object.keys(fix).length) useStore.setState(fix)
}

repairPersisted()
