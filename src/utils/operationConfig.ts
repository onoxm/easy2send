// src/utils/operationConfig.ts
import useStore from '@/store'
import { appDataDir, dirname, join, resourceDir } from '@tauri-apps/api/path'
import { mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

// ============ 常量定义 ============
export const CONFIG_DIR = 'config'
export const BASE_CONFIG_FILE = 'base.conf.json'
export const APP_CONFIG_FILE = 'app.conf.json'

// ============ 内部路径工具 ============
async function getUserConfigPath(): Promise<string> {
  const base = await appDataDir()
  return join(base, CONFIG_DIR, APP_CONFIG_FILE)
}

async function getDefaultConfigPath(): Promise<string> {
  const base = await resourceDir()
  return join(base, CONFIG_DIR, BASE_CONFIG_FILE)
}

// ============ 公共 API ============

/**
 * 初始化用户配置：如果不存在，则从默认配置复制
 */
export async function initConfig(): Promise<void> {
  const userPath = await getUserConfigPath()
  try {
    await readTextFile(userPath)
    // 已存在，无需初始化
  } catch (_) {
    const defaultPath = await getDefaultConfigPath()
    const defaultContent = await readTextFile(defaultPath)
    const dir = await dirname(userPath)
    await mkdir(dir, { recursive: true })
    await writeTextFile(userPath, defaultContent)
  }
}

/**
 * 读取用户配置（JSON 格式）
 */
export async function readConfig<T = any>(): Promise<T> {
  const path = await getUserConfigPath()
  const content = await readTextFile(path)
  return JSON.parse(content)
}

/**
 * 写入用户配置
 */
export async function writeConfig(config: Object): Promise<void> {
  const path = await getUserConfigPath()
  const dir = await dirname(path)
  await mkdir(dir, { recursive: true })
  await writeTextFile(path, JSON.stringify(config, null, 2))
}

/**
 * 恢复默认配置（覆盖用户配置）
 */
export async function resetConfig(): Promise<void> {
  const defaultPath = await getDefaultConfigPath()
  const defaultContent = await readTextFile(defaultPath)
  const userPath = await getUserConfigPath()
  await writeTextFile(userPath, defaultContent)
  console.log('重置配置:', defaultContent)

  useStore.setState({ ...JSON.parse(defaultContent) })
}

// ============ 兼容旧接口（与旧 Hook 无缝衔接） ============

/**
 * 旧版 get 方法，保持与原有 useConfig Hook 兼容
 */
export async function get(onSuccess: (conf: any) => void): Promise<void> {
  try {
    const config = await readConfig()
    // 拷贝逻辑（保留原样，虽然可能多余）
    const newConfig: any = {}
    Object.keys(config).forEach(key => {
      newConfig[key] = config[key]
    })
    onSuccess({ ...newConfig })
  } catch (error) {
    console.error('读取配置失败:', error)
    onSuccess({}) // 或根据业务抛出
  }
}

/**
 * 旧版 set 方法，保持兼容
 */
export async function set(config: Object): Promise<void> {
  // 参数 configFilePath 在新架构中忽略，路径固定
  await writeConfig(config)
}

// 默认导出保持与旧代码一致
export default { get, set }
