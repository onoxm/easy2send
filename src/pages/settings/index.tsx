import { setDeviceName } from '@/api/discovery'
import { windowBasicOperation } from '@/api/tauri'
import useStore from '@/store'
import { IconArrowLeft, IconEdit, IconFolder } from '@tabler/icons-react'
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
    version,
    theme
  } = useStore([
    'savePath',
    'canUpdate',
    'autoCheckUpdate',
    'deviceName',
    'concurrentUploads',
    'version',
    'theme'
  ])
  const [downloading, setLoading] = useState(false)
  const navigate = useNavigate()

  // 设置页与首页共用同一个窗口，路由切换即返回，需要一个显式的返回入口
  const handleBack = () => navigate('/')

  const savePathBtnList = [
    {
      txt: '打开文件夹',
      icon: <IconFolder size={18} stroke={2} />,
      onClick: () => {
        invoke('open_file', { path: savePath })
      }
    },
    {
      txt: '更改保存路径',
      icon: <IconEdit size={18} stroke={2} />,
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
            className="input bg-surface-muted text-ink-600 text-body/[17px] flex-1 cursor-default"
          />
          {savePathBtnList.map(({ txt, icon, onClick }) => (
            <button
              key={txt}
              title={txt}
              aria-label={txt}
              className="border border-line-200 p-2.25 rounded-md text-ink-600 shrink-0"
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
      children: (
        <div className="flex items-center gap-2.5">
          {/* OnoSelect 自带 .ono-select{width:100%}，宽度不受外层控制；设计稿里
              下拉框是固定 82 宽（3:387），这里加一层定宽容器把它钉住。 */}
          <OnoSelect
            selectClassName="input py-[7.5px] pl-[11px] pr-[9px] border border-line-200 bg-surface-base text-ink-900 text-card/[19px]"
            optionsClassName="border border-[#666]"
            isShowArrow={false}
            defaultValue={concurrentUploads}
            options={concurrentOptions.map(n => ({
              label: n + '',
              value: n
            }))}
            onChange={e => useStore.setState({ concurrentUploads: e })}
          />
          <p className="text-body/[17px] text-ink-500 font-normal shrink-0">
            个任务同时进行
          </p>
        </div>
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
          className="input border border-line-200 text-ink-900 text-card/[19px] flex-1"
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
            style={{ width: 36, height: 20 }}
            id="autoUpdate"
            color={theme === 'light' ? '#14a34a' : '#35c077'}
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
        <p className="py-2.5 px-3 text-ink-600 text-caption/[16px] font-normal">
          开启后自动检查新版本；右侧按钮在有可用更新时出现
        </p>
      )
    }
  ]

  return (
    <div className="w-full flex flex-col gap-3 py-5 px-7 bg-canvas">
      <div className="flex items-center gap-3">
        <button
          className="flex items-center gap-1.5 px-2.5 py-[7.5px] border border-line-200 bg-surface-base rounded-[10px] shrink-0"
          onClick={handleBack}
        >
          <span className="text-ink-600">
            <IconArrowLeft size={14} stroke={2} />
          </span>
          <span className="text-ink-700 text-body/[17px] font-medium">
            返回
          </span>
        </button>
        <div className="flex-1 flex flex-col gap-.75">
          <h1 className="text-[18px]/[26px] font-bold text-ink-900">设置</h1>
          <p className="text-caption/[16px] font-normal text-ink-400">
            偏好设置修改后立即生效
          </p>
        </div>
        <span className="shrink-0 py-[1px] px-2.25 border border border-line-200 bg-surface-base rounded-pill text-caption/[16px] text-ink-500">
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
