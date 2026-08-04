import { setDeviceName } from '@/api/discovery'
import { windowBasicOperation } from '@/api/tauri'
import { ICON_INFO } from '@/common/common'
import useStore from '@/store'
import { EditTwo, FolderOpen } from '@icon-park/react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { check } from '@tauri-apps/plugin-updater'
import { Button, Switch } from 'ono-react-element'
import { useState } from 'react'
import { SettingsBar } from './SettingsBar'

export default () => {
  const { savePath, autoCheckUpdate, canUpdate, deviceName } = useStore([
    'savePath',
    'canUpdate',
    'autoCheckUpdate',
    'deviceName'
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
      title: '设备别名',
      children: (
        <input
          type="text"
          value={deviceName}
          maxLength={32}
          placeholder="其他设备看到的名字"
          className="text bg-stone-200 p-1 px-2 rounded-md outline-none flex-1"
          onChange={e => useStore.setState({ deviceName: e.target.value })}
          onBlur={() => setDeviceName(deviceName).catch(console.error)}
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
    <div className="flex flex-col gap-2">
      <h1>设置</h1>
      {settingsBarList.map(({ title, children }) => (
        <SettingsBar key={title} title={title}>
          {children}
        </SettingsBar>
      ))}
    </div>
  )
}
