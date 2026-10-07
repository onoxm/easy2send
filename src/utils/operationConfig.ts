// src/utils/operationConfig.ts
import { appDataDir, dirname, join, resourceDir } from '@tauri-apps/api/path'
import { mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

// ============ 常量定义（仅本模块使用，不对外暴露） ============
const CONFIG_DIR = 'config'
const BASE_CONFIG_FILE = 'base.conf.json'
const APP_CONFIG_FILE = 'app.conf.json'

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

// ============ 读取 / 写入（useConfig 使用的入口） ============

/**
 * 读取配置并交给调用方。
 *
 * 读失败（首次启动尚无配置文件、或文件被改坏）时交一个空对象而不是抛出：
 * 配置读不出来不该让应用起不来 —— store 里的默认值本身可用，用户改一下设置
 * 就会重新写一份出来。
 */
export async function get(onSuccess: (conf: any) => void): Promise<void> {
  try {
    onSuccess(await readConfig())
  } catch (error) {
    console.error('读取配置失败:', error)
    onSuccess({})
  }
}

/** 写入配置（路径固定，调用方不必关心存到哪） */
export async function set(config: Object): Promise<void> {
  await writeConfig(config)
}

export default { get, set }
