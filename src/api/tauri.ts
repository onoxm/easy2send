import { invoke } from '@tauri-apps/api/core'
import { Event, listen } from '@tauri-apps/api/event'
import {
  appDataDir,
  desktopDir,
  documentDir,
  downloadDir,
  join,
  resourceDir
} from '@tauri-apps/api/path'
import type { WebviewOptions } from '@tauri-apps/api/webview'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize, Window, WindowOptions } from '@tauri-apps/api/window'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  writeFile as writeBinaryFile,
  writeTextFile
} from '@tauri-apps/plugin-fs'
import { exit, relaunch } from '@tauri-apps/plugin-process'

export type fileSaveType = 'jpeg' | 'png' | 'webp' | 'json'

type WindowBasicOperationType =
  | 'minimize'
  | 'toggleMaximize'
  | 'close'
  | 'top'
  | 'noTop'
  | 'restart'
  | 'exit'

// 窗口操作
export const windowBasicOperation = (
  label: string,
  type: WindowBasicOperationType
) => {
  switch (type) {
    // 重启
    case 'restart':
      relaunch()
      break
    // 退出
    case 'exit':
      exit()
      break
    // 置顶
    case 'top':
      new Window(label).setAlwaysOnTop(true)
      break
    // 取消置顶
    case 'noTop':
      new Window(label).setAlwaysOnTop(false)
      break
    default:
      new Window(label)[type]()
      break
  }
}

// 将下面代码复制到main.rs
// #[derive(Clone, serde:: Serialize)]
// struct Payload {
//     message: String,
// }

// impl Payload {
//     fn new (message: String) -> Self {
//         Self { message }
//     }
// }

// #[tauri::command]
// fn transfer_data(window: Window, event_name: String, message: String) {
//     let mut time = 0;
//     std::thread::spawn(move || loop {
//         window
//             .emit(event_name.as_str(), Payload::new(message.clone().into()))
//             .unwrap();

//         thread:: sleep(time:: Duration:: from_millis(500));
//     time = time + 1;

//     if time == 2 {
//         break; // 通过 break 语句停止循环
//     };
// });
// }

// 窗口间通讯
export const transferData = {
  sendMessage(eventName: string, message: string) {
    invoke('transfer_data', { eventName, message })
  },

  async listenMessage(
    eventName: string,
    onSuccess: (event: Event<string>) => void
  ) {
    await listen<string>(eventName, event => onSuccess(event))
  }
}

// 创建新窗口
export const createNewWindow = (
  label: string,
  options: Omit<WebviewOptions, 'x' | 'y' | 'width' | 'height'> &
    WindowOptions & {
      onSuccess?: () => void
      onError?: (e: Event<unknown>) => void
    }
) => {
  const { onSuccess, onError, ...rest } = options
  const webview = new WebviewWindow(label, rest)
  webview.once('tauri://created', () => onSuccess?.())
  webview.once('tauri://error', e => onError?.(e))
}

export const basePath = {
  app: () => appDataDir(),
  desktop: () => desktopDir(),
  download: () => downloadDir(),
  document: () => documentDir(),
  resource: async (platform: string) => {
    const path = await resourceDir()
    const formatWindowsPath = (path: string) =>
      path.split('?')[1].split('').slice(1).join('')
    return platform === 'windows' ? formatWindowsPath(path) : path
  }
}

const changeName = (fileType: string | string[]) => {
  switch (fileType) {
    case 'json':
      return 'text'
    case 'db':
      return 'text'

    default:
      return 'image'
  }
}

export const getSavePath = async (
  filePath: string,
  fileType: string | string[],
  filename: string
) => {
  const path = await join(filePath, `${filename}.${fileType}`)
  const selPath = await save({
    defaultPath: path,
    filters: [
      {
        name: changeName(fileType),
        extensions: fileType instanceof Array ? fileType : [fileType]
      }
    ]
  })
  return selPath ? selPath!.replace(/Untitled$/, '') : ''
}

export const getOpenPath = async ({
  filePath,
  multiple = false,
  directory = false,
  fileTypes
}: {
  filePath: string
  multiple?: boolean
  directory?: boolean
  fileTypes?: string[]
}) => {
  const selPath = await open({
    title: '选择',
    defaultPath: `${filePath}`,
    multiple,
    directory,
    filters: fileTypes
      ? fileTypes.map(type => ({
          name: changeName(type),
          extensions: [type]
        }))
      : []
  })
  return typeof selPath === 'string' ? [selPath] : selPath
}

// 写入文件
export const writeFile = async (options: {
  file: Blob | string
  savePath: string
  fileSaveType: fileSaveType
  filename?: string
  isSaveDirectly?: boolean
}) => {
  const {
    file,
    savePath,
    fileSaveType,
    filename = 'Untitled',
    isSaveDirectly
  } = options
  const type = fileSaveType === 'jpeg' ? 'jpg' : fileSaveType
  const selPath = (
    isSaveDirectly
      ? `${savePath}${filename}.${type}`
      : await getSavePath(savePath, type, filename)
  ).replace(/Untitled$/, '')
  // const selPath = await getSavePath(savePath, type, filename)
  if (!selPath) return

  switch (typeof file === 'object' && file instanceof Blob) {
    case true:
      const reader = new FileReader()
      reader.readAsArrayBuffer(file as Blob)
      reader.onload = ev =>
        writeBinaryFile(
          selPath,
          new Uint8Array(ev.target?.result as ArrayBufferLike)
        )
      // writeBinaryFile(`${filename}.${type}`, new Uint8Array(ev.target?.result as ArrayBufferLike), {
      //     dir: savePath as unknown as BaseDirectory,
      // })
      break
    case false:
      writeTextFile(selPath, file as string)
      break

    default:
      break
  }
}

// 设置鼠标穿透
export const setMousePenetration = (label: string, bl: boolean) =>
  new Window(label).setIgnoreCursorEvents(bl)

// 改变窗口尺寸
export const changeWindowSize = (
  label: string,
  width: number,
  height: number
) => new Window(label).setSize(new LogicalSize(width, height))

// 改变窗口是否显示在任务栏
export const changeWindowSkipTaskbar = (
  label: string,
  isSkipTaskbar: boolean
) => new Window(label).setSkipTaskbar(isSkipTaskbar)

// 本次启动期间是否已取消过更新（会话级，重启后重置）
export const isUpdateDismissed = () => invoke<boolean>('is_update_dismissed')

export const setUpdateDismissed = () => invoke('set_update_dismissed')
