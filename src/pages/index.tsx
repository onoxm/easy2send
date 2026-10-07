import { connectByAddr, connectDevice } from '@/api/discovery'
import { createPairToken, startWebUpload, stopWebUpload } from '@/api/webupload'
import {
  innerToast,
  Layout,
  manualLinkDialog,
  PeerAvatar,
  PeerIdentity,
  qrUploadDialog
} from '@/components'
import { useDevices } from '@/hooks'
import { useStore } from '@/store'
import {
  IconChevronRight,
  IconContrast,
  IconLink,
  IconMoon,
  IconQrcode,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSun
} from '@tabler/icons-react'
import { chainClassNames, ThemeMode, useThemePro } from 'ono-react-element'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'

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

export default () => {
  const { devices, refresh } = useDevices()
  const { deviceName, ip, port, savePath, theme } = useStore([
    'deviceName',
    'ip',
    'port',
    'savePath',
    'theme'
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
      innerToast.error(`连接失败: ${error}`)
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
      innerToast.error(`连接失败: ${error}`)
    } finally {
      setConnecting(null)
    }
  }

  // 手机上传：点击时启动 HTTP 服务器 + 生成 token + 打开二维码弹窗
  // 服务器在用户扫码配对后保持运行，退出传输页时才停止
  const handleWebUpload = async () => {
    try {
      if (!ip || !savePath) {
        innerToast.error('网络或保存路径未就绪，请稍后再试')
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
      innerToast.error(`启动手机上传失败: ${e}`)
      stopWebUpload().catch(() => {})
    }
  }

  const btnList = [
    {
      text: '扫码连接',
      className:
        'bg-brand-500 text-on-brand shadow-[var(--shadow-brand)] state-brand',
      icon: <IconQrcode stroke={2} />,
      onClick: handleWebUpload
    },
    {
      text: '手动连接',
      className:
        'border border-line-200 bg-surface-base text-ink-700 state-neutral',
      icon: (
        <div className="text-ink-600">
          <IconLink stroke={2} />
        </div>
      ),
      onClick: () => manualLinkDialog(handleManualConnect)
    }
  ]

  useEffect(() => {
    useStore.setState({
      theme: currentTheme
    })
  }, [currentTheme])

  return (
    <Layout>
      <div className="w-full flex justify-between">
        <div className="flex justify-center items-center gap-[9px]">
          <h2 className="text-ink-900 text-sm/[20px] font-semibold">
            Easy2Send
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* 三态循环：跟随系统 → 浅色 → 深色（切换逻辑见 hooks/useTheme.ts） */}
          <button
            type="button"
            className="little_btn p-1.5 bg-surface-base state-neutral"
            title={`主题：${THEME_LABEL[theme]}`}
            aria-label={`主题：${THEME_LABEL[theme]}，点击切换`}
            onClick={e => nextTheme({ element: e.currentTarget })}
          >
            <ThemeIcon theme={theme} />
          </button>

          <Link
            to="/settings"
            className="little_btn p-1.5 bg-surface-base state-neutral"
          >
            <IconSettings size={20} stroke={2} />
          </Link>
        </div>
      </div>

      <div className="w-[480px] flex flex-col gap-[18px]">
        <div className="flex flex-col gap-[5px]">
          <h1 className="text-ink-900 text-4.75/[28px] font-bold">
            {deviceName || '...'}
          </h1>

          <div className="flex gap-[7px] items-center">
            <div className="bg-success-600 w-[7px] h-[7px] rounded-full"></div>

            <p className="text-ink-500 text-body/[1.4167] font-normal">
              已就绪 · {ip}:{port}
            </p>
          </div>
        </div>

        <div className="w-full bg-surface-base border border-line-200 rounded-lg shadow-[var(--shadow-e1)]">
          <div className="w-full h-[44px] px-[14px] flex justify-between items-center">
            <p className="flex gap-[7px] items-center">
              <span className="text-card/[1.4615] text-ink-700 font-medium">
                在线设备
              </span>
              <span className="w-[21px] h-[18px] rounded-full bg-line-100 text-caption text-ink-600 font-medium flex justify-center items-center">
                {devices.length}
              </span>
            </p>

            <button
              className="w-7 h-7 bg-surface-muted flex justify-center items-center rounded-sm text-ink-600 border border-line-100 state-tint"
              onClick={async e => {
                const svg = e.currentTarget.children[0]
                svg.classList.add('loading')
                await refresh()
                setTimeout(() => svg.classList.remove('loading'), 500)
              }}
            >
              <IconRefresh size={18} stroke={2} />
            </button>
          </div>

          {devices.length === 0 ? (
            <div className="h-[215px] border-t border-line-100 flex flex-col gap-2 justify-center items-center">
              <div className="text-ink-300">
                <IconSearch size={32} stroke={2} />
              </div>
              <p className="text-ink-600 text-body/[1.4167]">暂无在线设备</p>
              <p className="text-ink-400 text-caption font-normal">
                请确认其他设备已启动 Easy2Send
              </p>
            </div>
          ) : (
            <OverlayScrollbarsComponent
              className="h-[215px] border-t border-line-100"
              options={{
                scrollbars: {
                  theme: 'os-theme-dark',
                  autoHide: 'leave',
                  autoHideDelay: 0
                }
              }}
              defer
            >
              <div className="p-2 flex flex-col gap-[6px]">
                {/* 设备行的 chrome 正是设计稿「次按钮」的配方（白底 surface.base +
                    line.200 描边），按按钮状态规范 43:2「白底按钮走中性色阶（悬停
                    surface.muted / 按下 line.100）」补 state-neutral；
                    连接期间整列不可点，按按钮禁用态的约定（整帧 opacity .5）呈现。 */}
                {devices.map(
                  ({ deviceId, deviceName, ip, port, platform, version }) => (
                    <button
                      key={deviceId}
                      className="w-full h-15 border border-line-200 flex items-center gap-3 px-3 justify-center rounded-md state-neutral disabled:opacity-50"
                      disabled={connecting !== null}
                      onClick={() => handleConnect(deviceId)}
                    >
                      <PeerAvatar platform={platform} />
                      <PeerIdentity
                        name={deviceName}
                        subtitle={`${ip}:${port} · ${platform} · v${version}`}
                      />

                      {connecting === deviceId ? (
                        <span className="text-caption text-ink-400 font-normal">
                          等待对方确认...
                        </span>
                      ) : (
                        <div className="text-ink-300">
                          <IconChevronRight size={16} stroke={2} />
                        </div>
                      )}
                    </button>
                  )
                )}
              </div>
            </OverlayScrollbarsComponent>
          )}
        </div>

        <div className="w-full flex gap-[10px]">
          {btnList.map(({ text, className, icon, onClick }) => (
            <button
              key={text}
              className={chainClassNames(
                'flex-1 h-10 rounded-md text-card flex gap-2 justify-center items-center',
                className
              )}
              onClick={onClick}
            >
              {icon}
              <span>{text}</span>
            </button>
          ))}
        </div>
      </div>
    </Layout>
  )
}
