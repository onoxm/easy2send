import { setDeviceName } from '@/api/discovery'
import { windowBasicOperation } from '@/api/tauri'
import { ICON_INFO } from '@/common/common'
import useStore from '@/store'
import { EditTwo, FolderOpen } from '@icon-park/react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { check } from '@tauri-apps/plugin-updater'
import { Button, OnoSelect, Switch } from 'ono-react-element'
import { useState } from 'react'
import { SettingsBar } from './SettingsBar'

export default () => {
  const {
    savePath,
    autoCheckUpdate,
    canUpdate,
    deviceName,
    concurrentUploads
  } = useStore([
    'savePath',
    'canUpdate',
    'autoCheckUpdate',
    'deviceName',
    'concurrentUploads'
  ])
  const [downloading, setLoading] = useState(false)

  const savePathBtnList = [
    {
      txt: '打开文件夹',
      icon: <FolderOpen {...ICON_INFO} />,
      onClick: () => {
        invoke('open_file', { path: savePath })
      }
    },
    {
      txt: '更改保存路径',
      icon: <EditTwo {...ICON_INFO} />,
      onClick: async () => {
        const selected = await open({
          directory: true,
          multiple: false,
          title: '选择文件保存目录'
        })

        if (selected && typeof selected === 'string') {
          useStore.setState({ savePath: selected })
        }
      }
    }
  ]

  const handleUpdate = async () => {
    setLoading(true)
    const update = await check()
    if (update) {
      await update.downloadAndInstall()
      useStore.setState({ canUpdate: false })
      windowBasicOperation({ type: 'restart' })
    }
  }

  const concurrentOptions = [1, 2, 3, 4, 5]
  const settingsBarList = [
    {
      title: '保存路径',
      children: (
        <>
          <input
            readOnly
            type="text"
            value={savePath}
            className="text bg-stone-200 p-1 px-2 rounded-md outline-none flex-1"
          />
          {savePathBtnList.map(({ txt, icon, onClick }) => (
            <button
              key={txt}
              className="little_btn hover:bg-gray-200 hover:text-gray-800"
              onClick={onClick}
            >
              {icon}
            </button>
          ))}
        </>
      )
    },
    {
      title: '并发传输数',
      help: (
        <span className="text-sm text-gray-500">
          同时发送多个文件时，最多并发的任务数（范围 1-5，默认 2）
        </span>
      ),
      children: (
        <OnoSelect
          defaultValue={concurrentUploads}
          options={concurrentOptions.map(n => ({
            label: n + '',
            value: n
          }))}
          onChange={e => useStore.setState({ concurrentUploads: e })}
        />
      )
    },
    {
      title: '设备别名',
      children: (
        <input
          type="text"
          value={deviceName}
          maxLength={32}
          placeholder="其他设备看到的名字（1-32 字符，不含点号）"
          className="text bg-stone-200 p-1 px-2 rounded-md outline-none flex-1"
          onChange={e => useStore.setState({ deviceName: e.target.value })}
          onBlur={async () => {
            try {
              await setDeviceName(deviceName)
            } catch (e) {
              alert(`设备别名修改失败: ${e}`)
            }
          }}
        />
      )
    },
    {
      title: '自动更新',
      children: (
        <>
          <Switch
            style={{ width: 40, height: 24 }}
            id="autoUpdate"
            color={'#22c55e'}
            checked={autoCheckUpdate}
            onChange={bl =>
              useStore.setState(
                Object.assign(
                  { autoCheckUpdate: bl },
                  bl ? { updateNow: true } : {}
                )
              )
            }
          />
          {canUpdate && (
            <Button loading={downloading} onClick={handleUpdate}>
              更新软件
            </Button>
          )}
        </>
      )
    }
  ]

  return (
    <div className="w-full flex-1 flex flex-col gap-2 p-3">
      <h1>设置</h1>
      {settingsBarList.map(({ title, help, children }) => (
        <SettingsBar key={title} title={title} help={help}>
          {children}
        </SettingsBar>
      ))}
    </div>
  )
}
