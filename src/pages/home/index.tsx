import { connectByAddr, connectDevice } from '@/api/discovery'
import { createPairToken, startWebUpload, stopWebUpload } from '@/api/webupload'
import {
  IconButton,
  Logo,
  manualLinkDialog,
  OverlayScroll,
  PlatformIcon,
  qrUploadDialog,
  toast
} from '@/components'
import { useDevices } from '@/hooks'
import { useStore } from '@/store'
import {
  IconBroadcast,
  IconContrast,
  IconCopy,
  IconLink,
  IconMoon,
  IconQrcode,
  IconRefresh,
  IconSettings,
  IconSun
} from '@tabler/icons-react'
import {
  chainClassNames,
  copyText,
  ThemeMode,
  useThemePro
} from 'ono-react-element'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { BasicButton } from './BasicButton'
import { DeviceTile } from './DeviceTile'

/** 三态主题的说明文字（按钮的 title / aria-label） */
const THEME_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色'
}

/** 图标跟着当前模式走：对比度=跟随系统，太阳=浅色，月亮=深色 */
const ThemeIcon = ({ theme }: { theme: ThemeMode }) => {
  if (theme === 'light') return <IconSun size={20} stroke={2} />
  if (theme === 'dark') return <IconMoon size={20} stroke={2} />
  return <IconContrast size={20} stroke={2} />
}

const BtnClassName =
  'h-8 px-3 flex items-center gap-1.5 rounded-control border border-line-200 bg-surface-base text-caption text-ink-600 state-neutral'

export default () => {
  const { devices, refresh } = useDevices()
  const { deviceName, ip, port, savePath, theme, version } = useStore([
    'deviceName',
    'ip',
    'port',
    'savePath',
    'theme',
    'version'
  ])
  const [connecting, setConnecting] = useState<string | null>(null)
  const navigate = useNavigate()

  const { theme: currentTheme, nextTheme } = useThemePro({
    initTheme: theme
  })

  // 点击设备 → 发送握手 → 等对方确认 → 跳转传输页
  //
  // 对方若是首次遇到本机，会弹窗询问，这里最长要等 30 秒才返回；
  // 对方已信任本机时则是即时返回。
  const handleConnect = async (deviceId: string) => {
    setConnecting(deviceId)
    try {
      const peer = await connectDevice(deviceId)
      useStore.setState({ connectedDevice: peer })
      navigate('/transfer')
    } catch (error) {
      toast.error(`连接失败: ${error}`)
    } finally {
      setConnecting(null)
    }
  }

  // 手动输入 IP:端口 连接（mDNS 发现不到对方时使用）
  const handleManualConnect = async (
    manualAddr: string,
    onSuccess: () => void
  ) => {
    const addr = manualAddr.trim()
    if (!addr) return
    setConnecting('manual')
    try {
      const peer = await connectByAddr(addr)
      useStore.setState({ connectedDevice: peer })
      navigate('/transfer')
      onSuccess()
    } catch (error) {
      toast.error(`连接失败: ${error}`)
    } finally {
      setConnecting(null)
    }
  }

  // 手机上传：点击时启动 HTTP 服务器 + 生成 token + 打开二维码弹窗
  // 服务器在用户扫码配对后保持运行，退出传输页时才停止
  const handleWebUpload = async () => {
    try {
      if (!ip || !savePath) {
        toast.error('网络或保存路径未就绪，请稍后再试')
        return
      }
      const webPort = await startWebUpload(ip, savePath)
      const token = await createPairToken()
      // token 放 fragment 而非 query：fragment 不会被浏览器发往服务器，
      // 既不进服务端日志，也不会随同源资源的 Referer 泄漏
      const url = `http://${ip}:${webPort}/#token=${token}`
      qrUploadDialog({
        url,
        width: 260,
        // 用户手动关闭弹窗且未配对时才停止服务器；
        // 配对成功后弹窗自动关闭，服务器保持运行直到退出传输页
        onClose: () => stopWebUpload().catch(() => {})
      })
    } catch (e) {
      toast.error(`启动手机上传失败: ${e}`)
      stopWebUpload().catch(() => {})
    }
  }

  const iconList = [
    {
      title: `主题：${THEME_LABEL[theme]}`,
      ariaLabel: `主题：${THEME_LABEL[theme]}，点击切换`,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) =>
        nextTheme({ element: e.currentTarget }),
      icon: <ThemeIcon theme={theme} />
    },
    {
      title: '设置',
      ariaLabel: '跳转到设置页',
      onClick: () => navigate('/settings'),
      icon: <IconSettings size={20} stroke={2} />
    }
  ]

  const btnList = [
    { content: '扫码传输', onClick: handleWebUpload, Icon: IconQrcode },
    {
      content: '重新扫描',
      onClick: async (e: React.MouseEvent) => {
        const svg = e.currentTarget.querySelector('svg')
        svg?.classList.add('loading')
        await refresh()
        setTimeout(() => svg?.classList.remove('loading'), 500)
      },
      Icon: IconRefresh
    }
  ]

  useEffect(() => {
    useStore.setState({
      theme: currentTheme
    })
  }, [currentTheme])

  return (
    <div className="w-full h-full flex flex-col items-center justify-between pt-5.5 pb-4.5 px-7 gap-5">
      <div className="w-full flex justify-between">
        <div className="flex justify-center items-center gap-[9px]">
          <Logo size={24} className="shrink-0" />
          <h2 className="text-ink-900 text-sm/[20px] font-semibold">
            Easy2Send
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {iconList.map(({ title, ariaLabel, icon, onClick }) => (
            <IconButton
              key={title}
              title={title}
              ariaLabel={ariaLabel}
              onClick={onClick}
            >
              {icon}
            </IconButton>
          ))}
        </div>
      </div>

      <div className="w-full flex items-center gap-3 p-3 pl-3.5 bg-surface-muted rounded-card">
        <div className="p-2.5 bg-surface-base rounded-3 text-ink-700">
          <PlatformIcon platform={'windows'} size={20} />
        </div>

        <div className="flex-1 flex flex-col gap-.75">
          <div className="flex gap-1.75 items-center">
            <h1 className="text-ink-900 text-3.75/4.5 font-normal">
              {deviceName || '...'}
            </h1>

            <div className="bg-success-600 w-1.75 h-1.75 rounded-full"></div>

            <p className="text-ink-500 text-body/4.25 font-normal text-center">
              已就绪
            </p>
          </div>

          <p className="text-ink-500 text-body/4.25 font-normal">
            {ip}:{port}
          </p>
        </div>

        <BasicButton
          className={BtnClassName}
          Icon={IconCopy}
          onClick={() => {
            copyText(`${ip}:${port}`)
            toast.success('复制成功')
          }}
        >
          复制地址
        </BasicButton>
      </div>

      <div className="w-full flex-1 min-h-0 flex flex-col gap-3.5">
        <div className="w-full h-[44px] px-[14px] flex justify-between items-center">
          <p className="flex gap-[7px] items-center">
            <span className="text-card/[1.4615] text-ink-700 font-medium">
              附近设备
            </span>
            <span className="w-[21px] h-[18px] rounded-full bg-line-100 text-caption text-ink-600 font-medium flex justify-center items-center">
              {devices.length}
            </span>
          </p>

          <div className="flex items-center gap-1">
            {btnList.map(({ content, onClick, Icon }) => (
              <BasicButton
                key={content}
                className="h-7 px-2 flex items-center gap-1.5 rounded-control text-caption text-ink-500 state-neutral"
                Icon={Icon}
                onClick={onClick}
              >
                {content}
              </BasicButton>
            ))}
          </div>
        </div>

        {devices.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col gap-4 justify-center items-center">
            <div className="text-ink-300">
              <IconBroadcast size={48} stroke={2} />
            </div>
            <p className="flex flex-col gap-1.5 text-center">
              <span className="text-ink-700 text-section/5.5 font-medium">
                附近还没有设备
              </span>
              <span className="text-ink-400 text-body/4.25 font-normal">
                请确认对方已启动 Easy2Send，并与本机连在同一个网络
              </span>
            </p>
            <BasicButton
              className={BtnClassName}
              Icon={IconQrcode}
              onClick={handleWebUpload}
            >
              扫码传输
            </BasicButton>
          </div>
        ) : (
          <OverlayScroll
            className="flex-1 min-h-0"
            options={{
              scrollbars: {
                theme: 'os-theme-dark',
                autoHide: 'leave',
                autoHideDelay: 0
              }
            }}
            defer
          >
            <div
              className={chainClassNames(
                'gap-3.5',
                devices.length === 1
                  ? 'flex flex-col'
                  : 'grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
              )}
            >
              {devices.map(device => (
                <DeviceTile
                  key={device.deviceId}
                  device={device}
                  disabled={connecting !== null}
                  waiting={connecting === device.deviceId}
                  onClick={() => handleConnect(device.deviceId)}
                />
              ))}
            </div>
          </OverlayScroll>
        )}
      </div>

      <div className="w-full flex justify-between items-center">
        <BasicButton
          className={BtnClassName}
          Icon={IconLink}
          onClick={() => manualLinkDialog(handleManualConnect)}
        >
          手动输入 IP
        </BasicButton>

        <p className="text-center text-caption text-ink-400">
          Easy2Send v{version}
        </p>
      </div>
    </div>
  )
}
