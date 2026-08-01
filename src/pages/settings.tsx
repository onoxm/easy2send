import { windowBasicOperation } from '@/api/tauri'
import useStore from '@/store'
import { open } from '@tauri-apps/plugin-dialog'
import { check } from '@tauri-apps/plugin-updater'
import { Button, Switch } from 'ono-react-element'
import { useState } from 'react'

export default () => {
  const { savePath, autoCheckUpdate, canUpdate } = useStore([
    'savePath',
    'canUpdate',
    'autoCheckUpdate'
  ])
  const [downloading, setLoading] = useState(false)

  // 选择保存目录
  const selectSaveDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择文件保存目录'
    })

    if (selected && typeof selected === 'string') {
      useStore.setState({ savePath: selected })
    }
  }

  const handleUpdate = async () => {
    setLoading(true)
    const update = await check()
    if (update) {
      await update.downloadAndInstall()
      useStore.setState({ canUpdate: false })
      windowBasicOperation('main', 'restart')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h1>设置</h1>
      <div>
        <span>{savePath || '未选择'}</span>
        <button
          className="bg-blue-500 text-white p-1 rounded-sm cursor-pointer"
          onClick={selectSaveDir}
          style={{ marginRight: '10px' }}
        >
          📂 选择保存目录
        </button>
      </div>
      <div className="flex items-center gap-2">
        <h3>自动更新</h3>
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
      </div>
    </div>
  )
}
