import { connectByAddr, connectDevice } from '@/api/discovery'
import { createPairToken, startWebUpload, stopWebUpload } from '@/api/webupload'
import {
  Layout,
  manualLinkDialog,
  PlatformIcon,
  qrUploadDialog
} from '@/components'
import { useDevices } from '@/hooks'
import useStore from '@/store'
import {
  IconChevronRight,
  IconInfoCircle,
  IconLink,
  IconQrcode,
  IconRefresh,
  IconSearch,
  IconSettings
} from '@tabler/icons-react'
import { chainClassNames, Popover, toast } from 'ono-react-element'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

export default () => {
  const { devices, refresh } = useDevices()
  const { deviceName, ip, port, savePath } = useStore([
    'deviceName',
    'ip',
    'port',
    'savePath'
  ])
  const [connecting, setConnecting] = useState<string | null>(null)
  const navigate = useNavigate()

  // const [, changeTheme] = useThemePro({
  //   initTheme: theme as 'light' | 'dark',
  //   themeRules: isDark => {
  //     const theme = isDark ? 'dark' : 'light'
  //     useStore.setState({ theme })
  //   }
  // })

  // const changeThemeIcon = () =>
  //   theme === 'light' ? <SunOne {...ICON_INFO} /> : <Moon {...ICON_INFO} />

  // 点击设备 → 发送握手 → 跳转传输页
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
      const url = `http://${ip}:${webPort}/?token=${token}`
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

  const btnList = [
    {
      text: '扫码连接',
      className: 'bg-brand-500 text-on-brand',
      icon: <IconQrcode stroke={2} />,
      onClick: handleWebUpload
    },
    {
      text: '手动连接',
      className: 'border border-line-200 bg-surface-base text-ink-700',
      icon: (
        <div className="text-ink-600">
          <IconLink stroke={2} />
        </div>
      ),
      onClick: () =>
        manualLinkDialog({
          handleConnect: handleManualConnect
        })
    }
  ]

  return (
    <Layout>
      {/* <button
            className="little_btn"
            onClick={(e) =>
              changeTheme({
                targetTheme: theme === 'light' ? 'dark' : 'light',
                element: e.currentTarget
              })
            }
          >
            {changeThemeIcon()}
          </button> */}
      <div className="w-full flex justify-between">
        <div className="flex justify-center items-center gap-[9px]">
          <h2 className="text-ink-900 text-sm/[20px] font-semibold">
            Easy2Send
          </h2>
        </div>

        <Link
          to="/settings"
          className="w-8 h-8 rounded-md bg-surface-base border border-line-200 flex justify-center items-center text-ink-600"
        >
          <IconSettings stroke={2} />
        </Link>
      </div>

      <div className="w-[480px] flex flex-col gap-[18px]">
        <div className="flex flex-col gap-[5px]">
          <h1 className="text-ink-900 text-[19px]/[28px] font-bold">
            {deviceName || '...'}
          </h1>

          <div className="flex gap-[7px] items-center">
            <div className="bg-success-600 w-[7px] h-[7px] rounded-full"></div>

            <p className="text-ink-500 text-body/[17px] font-normal">
              已就绪 · {ip}:{port}
            </p>

            <Popover
              trigger="hover"
              placement="top-end"
              content={
                <p className="p-2">
                  当前地址: {ip}:{port}
                </p>
              }
            >
              <button
                aria-label={`关于“当前地址”的说明`}
                className="cursor-help text-ink-400"
              >
                <IconInfoCircle size={14} stroke={2} />
              </button>
            </Popover>
          </div>
        </div>

        <div className="w-full bg-surface-base border border-line-200 rounded-lg">
          <div className="w-full h-[44px] px-[14px] flex justify-between items-center">
            <p className="flex gap-[7px] items-center">
              <span className="text-card/[19px] text-ink-700 font-medium">
                在线设备
              </span>
              <span className="w-[21px] h-[18px] rounded-full bg-line-100 text-caption text-ink-600 font-medium flex justify-center items-center">
                {devices.length}
              </span>
            </p>

            <button
              className="w-7 h-7 bg-surface-muted flex justify-center items-center rounded-sm text-ink-600 border border-line-100"
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
              <p className="text-ink-600 text-body/[17px]">暂无在线设备</p>
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
                {devices.map(
                  ({ deviceId, deviceName, ip, port, platform, version }) => (
                    <button
                      key={deviceId}
                      className="w-full h-15 border border-line-200 flex items-center gap-3 px-3 justify-center rounded-md"
                      disabled={connecting !== null}
                      onClick={() => handleConnect(deviceId)}
                    >
                      <div className="w-9 h-9 bg-surface-muted rounded-md flex justify-center items-center text-ink-600">
                        <PlatformIcon platform={platform} size={20} />
                      </div>
                      <div className="flex flex-1 flex-col gap-[3px] text-left">
                        <p className="text-ink-900 text-card/[19px]">
                          {deviceName}
                        </p>
                        <p className="text-caption text-ink-400 font-normal">
                          {ip}:{port} · {platform} · v{version}
                        </p>
                      </div>

                      {connecting === deviceId ? (
                        <span className="text-caption text-ink-400 font-normal">
                          连接中...
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
