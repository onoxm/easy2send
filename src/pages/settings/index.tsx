import { setDeviceName } from '@/api/discovery'
import { windowBasicOperation } from '@/api/tauri'
import { ICON_INFO } from '@/common/common'
import useStore from '@/store'
import { EditTwo, FolderOpen } from '@icon-park/react'
import { IconArrowLeft } from '@tabler/icons-react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { check } from '@tauri-apps/plugin-updater'
import { Button, OnoSelect, Switch, toast } from 'ono-react-element'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { SettingsBar } from './SettingsBar'

export default () => {
  const {
    savePath,
    autoCheckUpdate,
    canUpdate,
    deviceName,
    concurrentUploads,
    version
  } = useStore([
    'savePath',
    'canUpdate',
    'autoCheckUpdate',
    'deviceName',
    'concurrentUploads',
    'version'
  ])
  const [downloading, setLoading] = useState(false)
  const navigate = useNavigate()

  // 设置页与首页共用同一个窗口，路由切换即返回，需要一个显式的返回入口
  const handleBack = () => navigate('/')

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
            className="input cursor-default"
          />
          {savePathBtnList.map(({ txt, icon, onClick }) => (
            <button
              key={txt}
              title={txt}
              aria-label={txt}
              className="little_btn hover:bg-gray-200 hover:text-gray-800 shrink-0"
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
          selectClassName="input border border-transparent"
          optionsClassName="border border-[#666]"
          isShowArrow={false}
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
          className="input border border-transparent focus:border-[#5C66E3]"
          onChange={e => useStore.setState({ deviceName: e.target.value })}
          onBlur={async () => {
            try {
              await setDeviceName(deviceName)
            } catch (e) {
              toast.error(`设备别名修改失败: ${e}`)
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
            style={{ width: 30, height: 18 }}
            id="autoUpdate"
            color={'#22c55e'}
            checked={autoCheckUpdate}
            aria-label="自动检查更新"
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
      ),
      help: (
        <span className="text-sm text-gray-500">
          开启后自动检查新版本；右侧按钮在有可用更新时出现
        </span>
      )
    }
  ]

  return (
    <div className="w-full flex-1 flex flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-1.5 h-8 px-2.5 border border-solid border-[#DEE3ED] bg-white rounded-[10px] text-[#4F5463] hover:bg-[#F7FAFC] shrink-0"
          onClick={handleBack}
        >
          <IconArrowLeft size={14} stroke={1.6} />
          <span className="text-xs font-medium">返回</span>
        </button>
        <h1 className="flex-1 text-2xl font-bold">设置</h1>
        <span className="shrink-0 h-6 flex items-center px-2.5 border border-solid border-[#DEE3ED] bg-white rounded-[6px] text-[11px] font-medium text-[#6B7385]">
          v{version}
        </span>
      </div>
      {settingsBarList.map(({ title, help, children }) => (
        <SettingsBar key={title} title={title} help={help}>
          {children}
        </SettingsBar>
      ))}
    </div>
  )
}
