import { setDeviceName } from '@/api/discovery'
import { cleanPartFiles, openFile } from '@/api/fs'
import { restartApp } from '@/api/tauri'
import { listTrustedDevices, revokeTrustedDevice } from '@/api/trust'
import {
  BackButton,
  IconButton,
  Logo,
  PeerIdentity,
  Select,
  toast
} from '@/components'
import { useStore, type CloseAction } from '@/store'
import type { TrustedDevice } from '@/types/trust'
import { IconBrandGithub, IconEdit, IconFolder } from '@tabler/icons-react'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { check } from '@tauri-apps/plugin-updater'
import { Button, formatTime, Switch } from 'ono-react-element'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { FontPicker } from './FontPicker'
import { SettingsBar } from './SettingsBar'

export default () => {
  const {
    savePath,
    autoCheckUpdate,
    notifyOnComplete,
    autoCleanPartFiles,
    canUpdate,
    deviceName,
    concurrentUploads,
    version,
    theme,
    fontFamily,
    fontScale,
    closeAction
  } = useStore([
    'savePath',
    'canUpdate',
    'autoCheckUpdate',
    'notifyOnComplete',
    'autoCleanPartFiles',
    'deviceName',
    'concurrentUploads',
    'version',
    'theme',
    'fontFamily',
    'fontScale',
    'closeAction'
  ])
  const [downloading, setLoading] = useState(false)
  // 已信任设备只在设置页用，所以随进随查、不放进全局 store ——
  // 它会被后端在别处改写（用户接受 / 超时），放进 store 反而要额外同步一份。
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([])
  const navigate = useNavigate()
  const location = useLocation()

  // 设置页与首页共用同一个窗口，路由切换即返回，需要一个显式的返回入口
  const handleBack = () => navigate('/')

  /** 最近连接时间：Unix 毫秒 → `YYYY-MM-DD HH:mm` */
  const formatTrustedTime = (ms: number) => {
    // 空值必须自己拦：formatTime 对 0 会给出 1970-01-01 08:00，
    // 而字段缺失（undefined/null）时它直接抛异常，会连累整个设置页
    if (!ms) return '—'
    // 库的默认格式带秒，这里显式去掉
    return formatTime(ms, 'YYYY-MM-DD hh:mm')
  }

  const refreshTrustedDevices = async () => {
    try {
      setTrustedDevices(await listTrustedDevices())
    } catch (e) {
      toast.error(`读取已信任设备失败: ${e}`)
    }
  }

  // 撤销不是拉黑：对方下次连接会重新弹窗确认，所以不做二次确认
  const handleRevoke = async (deviceId: string, deviceName: string) => {
    try {
      await revokeTrustedDevice(deviceId)
      await refreshTrustedDevices()
      toast.success(`已取消对「${deviceName}」的信任`)
    } catch (e) {
      toast.error(`取消信任失败: ${e}`)
    }
  }

  /**
   * 切换「清理未完成的文件」
   *
   * 除了写设置，打开时立刻清一次：用户点这个开关的意图就是「把那些半截文件处理掉」，
   * 让他为这个动作再重启一次软件说不通。清理只碰上次运行遗留的 `.part`，
   * 正在传输的文件在 active 组里，不受影响（见后端 transfer/parts.rs）。
   */
  const handleToggleClean = async (enabled: boolean) => {
    useStore.setState({ autoCleanPartFiles: enabled })
    if (!enabled) return
    try {
      const report = await cleanPartFiles()
      if (report.removed > 0) {
        toast.success(`已清理 ${report.removed} 个未完成的文件`)
      } else if (report.failed > 0) {
        // 被占用（常见于下载目录正被别的程序索引）不算失败，下次启动会自动重试
        toast.warning(`${report.failed} 个文件被占用，稍后会自动重试`)
      } else {
        toast.success('没有需要清理的文件')
      }
    } catch (e) {
      toast.error(`清理失败: ${e}`)
    }
  }

  useEffect(() => {
    refreshTrustedDevices()
  }, [])

  // 托盘「关于」跳过来时，得把视图带到页面底部的关于区块 —— 否则用户明明按的是
  // 「关于」，眼睛落到的却是顶部的「保存路径」。依赖 location.key 而不是 location.state：
  // 每次 navigate 都会生成新的 key，所以「人已经在设置页、又点了一次托盘」也能再滚一次。
  useEffect(() => {
    const state = location.state as { scrollToAbout?: boolean } | null
    if (!state?.scrollToAbout) return
    // 关于区块固定是设置页的最后一项 ⇒ 滚到文档底部与滚到它等价，省掉一个锚点。
    document.documentElement.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth'
    })
  }, [location.key])

  const savePathBtnList = [
    {
      txt: '打开文件夹',
      icon: <IconFolder size={18} stroke={2} />,
      onClick: () => {
        openFile(savePath)
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
      restartApp()
    }
  }

  // 外链一律交给系统默认浏览器：Tauri 的 webview 会拦截 `<a href>` 发起的**外部导航**
  // （点了不会离开应用，也不会报错），所以必须显式调 opener。所需权限
  // `opener:default` 已在 capabilities/default.json 里，且已含 allow-default-urls
  // ⇒ https 在白名单内，不需要额外加 scope。
  const handleOpenRepo = async () => {
    try {
      await openUrl('https://github.com/onoxm/easy2send')
    } catch (e) {
      toast.error(`打开仓库地址失败: ${e}`)
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
            className="input bg-surface-muted text-ink-600 text-body/[1.4167] flex-1 cursor-default"
          />
          {savePathBtnList.map(({ txt, icon, onClick }) => (
            <IconButton
              key={txt}
              title={txt}
              ariaLabel={txt}
              className="p-2.25"
              onClick={onClick}
            >
              {icon}
            </IconButton>
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
          <Select
            className="w-45"
            defaultValue={concurrentUploads}
            options={concurrentOptions.map(n => ({
              label: n + '',
              value: n
            }))}
            onChange={c =>
              useStore.setState({ concurrentUploads: c as number })
            }
          />
          <p className="text-body/[1.4167] text-ink-500 font-normal shrink-0">
            个任务同时进行
          </p>
        </div>
      )
    },
    {
      title: '设备别名',
      children: (
        /* 聚焦态按设计稿 3:600：描边 line.200 → brand.500 且线宽 1 → 1.5，外加外发光 */
        <input
          type="text"
          value={deviceName}
          maxLength={32}
          placeholder="其他设备看到的名字（1-32 字符，不含点号）"
          className="input border border-line-200 text-ink-900 text-card/[1.4615] flex-1 state-focus"
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
      title: '界面字体',
      children: (
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* OnoSelect 自带 .ono-select{width:100%}，宽度不受外层控制；与「并发传输数」
              一样加一层定宽容器钉住。字体名长短差异大，这里比那个下拉宽一些。 */}
          <div className="w-45">
            <FontPicker
              value={fontFamily}
              showOptionEntries={10}
              onChange={v => useStore.setState({ fontFamily: v })}
            />
          </div>
          {/* 预览的用处不在「换成了什么字体」（整界面已经变了），而在让用户亲眼看到
              **中文会不会跟着变** —— 选到纯拉丁字体时中文不变，这是这个功能最容易被
              误解的地方。样式跟着当前选择走，所以看到的就是最终效果。 */}
          <p
            className="text-body/[1.4167] text-ink-500 truncate font-normal shrink-0"
            style={{ fontFamily: fontFamily || undefined }}
          >
            附近的设备 · 传输完成 100%
          </p>
        </div>
      ),
      help: (
        <p className="text-ink-600 text-caption/[1.4545] font-normal">
          只影响桌面端界面。选中的字体会插到字体栈最前面，系统字体仍在后面兜底
          —— 所以选一个只有英文的字体时，中文不会跟着变。
        </p>
      )
    },
    {
      title: '字号缩放',
      children: (
        <div className="flex items-center gap-2.5">
          <div className="w-25 shrink-0">
            <Select
              defaultValue={fontScale}
              /* 只给到 90–130%：行高是按设计稿写死的像素值（正文 12px 对 17px 行高），
                 再往下缩会让文字在行盒里空一大截、再往上放则会挤在一起。字号缩放本身
                 是为了补偿不同字体的视觉大小差异，±30% 已远超所需。 */
              options={[90, 100, 110, 120, 130].map(n => ({
                label: `${n}%`,
                value: n
              }))}
              onChange={f => useStore.setState({ fontScale: f as number })}
            />
          </div>
          <p className="text-body/[1.4167] text-ink-500 font-normal shrink-0">
            换字体后觉得字偏大或偏小，用这里整体微调
          </p>
        </div>
      ),
      help: (
        <p className="text-ink-600 text-caption/[1.4545] font-normal">
          不同字体的字面高度不一样，同一个字号看起来会差不少。这里按比例缩放整套字阶。
        </p>
      )
    },
    {
      title: '已信任设备',
      children: (
        <div className="flex flex-col gap-2 flex-1 min-w-0 py-0.5">
          {trustedDevices.length === 0 ? (
            <p className="text-ink-500 text-body/[1.4167] font-normal">
              还没有已信任的设备。对方首次连接、你点「接受」之后会出现在这里
            </p>
          ) : (
            trustedDevices.map(({ deviceId, deviceName, lastSeen }) => (
              <div
                key={deviceId}
                className="w-full flex items-center gap-3 px-3 py-2 border border-line-200 rounded-md"
              >
                <PeerIdentity
                  name={deviceName || '未知设备'}
                  subtitle={`最近连接 ${formatTrustedTime(lastSeen)}`}
                />
                {/* 借用设置页「返回」按钮的次要按钮规格（描边 + surface.base +
                    control 圆角 + state-neutral），不为它单开一套观感 */}
                <button
                  className="shrink-0 px-2.5 py-[7.5px] border border-line-200 bg-surface-base rounded-control text-ink-700 text-body/[1.4167] font-medium state-neutral"
                  onClick={() => handleRevoke(deviceId, deviceName)}
                >
                  取消信任
                </button>
              </div>
            ))
          )}
        </div>
      ),
      help: (
        <p className="text-ink-600 text-caption/[1.4545] font-normal">
          这些设备再次连接会直接放行、不再询问。取消后对方下次连接会重新请求确认。
        </p>
      )
    },
    {
      title: '关闭窗口时',
      children: (
        <div className="flex items-center gap-2.5">
          {/* OnoSelect 自带 .ono-select{width:100%}，宽度不受外层控制；与「并发传输数」
              一样加一层定宽容器钉住 */}
          <div className="w-45 shrink-0">
            <Select
              defaultValue={closeAction}
              options={
                [
                  { label: '每次询问', value: 'ask' },
                  { label: '最小化到托盘', value: 'tray' },
                  { label: '退出软件', value: 'quit' }
                ] as { label: string; value: CloseAction }[]
              }
              onChange={v => useStore.setState({ closeAction: v })}
            />
          </div>
          <p className="text-body/[1.4167] text-ink-500 font-normal shrink-0">
            点窗口关闭按钮时怎么做
          </p>
        </div>
      ),
      help: (
        <p className="text-ink-600 text-caption/[1.4545] font-normal">
          只作用于窗口关闭按钮 ——
          托盘菜单里的「退出」是明确的退出意图，不受这里影响。「最小化到托盘」不会断开连接，
          程序留在后台继续接收文件。关窗弹窗里勾了「记住我的选择」写的就是这一项，
          想改回来也是在这里。
        </p>
      )
    },
    {
      /* 设计稿「04 设置窗口」的「传输完成通知」（浅色 131:13 / 暗色 131:32）——
         位置与「自动更新」一样挂在列表**末尾**，不插到它前面。
         没有 help：设计稿只画了「标签行 + 控件行」，没画 ⓘ；ⓘ 是 help 的附属
         触发源，多加一枚等于把当初裁定删掉的冗余又加回来。 */
      title: '传输完成通知',
      children: (
        <Switch
          style={{ width: 36, height: 20 }}
          id="notifyOnComplete"
          color={theme === 'light' ? '#14a34a' : '#35c077'}
          checked={notifyOnComplete}
          aria-label="传输完成通知"
          onChange={bl => useStore.setState({ notifyOnComplete: bl })}
        />
      )
    },
    {
      /* 设计稿里没有这一项，位置跟着「传输完成通知」—— 两者同属「传输收尾」，
         都排在列表末段，不插到「保存路径」「并发传输数」那些入口配置中间 */
      title: '清理未完成的文件',
      children: (
        <div className="flex items-center gap-2.5">
          <Switch
            style={{ width: 36, height: 20 }}
            id="autoCleanPartFiles"
            color={theme === 'light' ? '#14a34a' : '#35c077'}
            checked={autoCleanPartFiles}
            aria-label="自动清理未完成的文件"
            onChange={bl => void handleToggleClean(bl)}
          />
          <p className="text-body/[1.4167] text-ink-500 font-normal shrink-0">
            启动时删除上次没传完的临时文件
          </p>
        </div>
      ),
      help: (
        <p className="text-ink-600 text-caption/[1.4545] font-normal">
          传输中断（对方断网、强制关闭软件）时，保存目录里会留下 `.part`
          半成品。开启后每次启动自动删掉它们 ——
          只删本程序自己登记过的那几个，不会扫目录、也不会动别的文件；
          正在传输的文件同样不受影响。关掉则一直保留，需要自己手动清理。
        </p>
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
            /* ono 的 Button 默认 type=primary，底是它自己的蓝 #409eff、圆角 4、
                   padding 4/15、字号 16 —— 与设计稿的主按钮（brand.500 · 圆角 10 ·
                   高 36 · 13 Medium · 品牌投影）全不沾边，所以逐项覆盖。
                   hover:opacity-100 用来顶掉 .ono-btn-primary:hover{opacity:.9}：
                   它会叠在设计稿的 8% 黑遮罩之上，等于多压一层透明度。 */
            <Button
              loading={downloading}
              onClick={handleUpdate}
              className="px-4 py-[8.5px] text-card/[1.4615] rounded-control bg-brand-500 text-on-brand shadow-[var(--shadow-brand)] state-brand hover:opacity-100"
            >
              更新软件
            </Button>
          )}
        </>
      ),
      /* 气泡的内边距已由气泡本体提供（.ono-popover-content 自带 12px/16px），
             这里再叠一层 py-2.5 px-3 会变成双份内边距，所以只保留文字样式。 */
      help: (
        <p className="text-ink-600 text-caption/[1.4545] font-normal">
          开启后自动检查新版本；右侧按钮在有可用更新时出现
        </p>
      )
    },
    {
      title: '关于',
      children: (
        <>
          <Logo size={28} className="shrink-0" />
          <div className="flex flex-col gap-.75 min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-card/[1.4615] font-medium text-ink-900">
                Easy2Send
              </span>
              <span className="py-[1px] px-2.25 border border-line-200 bg-surface-base rounded-pill text-caption/[1.4545] text-ink-500">
                v{version}
              </span>
            </div>
            <p className="text-caption/[1.4545] font-normal text-ink-400 truncate">
              局域网内免配置互传文件，不用账号、不走云端
            </p>
          </div>
          {/* 协议做成纯展示徽标：想知道全文的人点右侧仓库链接即可 —— 这里再挂一个
              独立出口，将来换协议或改年份就多一处要同步，而它本来不会有人点。 */}
          {/*<span className="py-[1px] px-2.25 border border-line-200 bg-surface-base rounded-pill text-caption/[1.4545] text-ink-500 shrink-0">
            MIT
          </span>*/}
          {/* 借用设置页「返回」按钮的次要按钮规格（描边 + surface.base + 10 圆角 +
              state-neutral），不再为它单开一套观感 */}
          <button
            className="flex items-center gap-1.5 px-2.5 py-[7.5px] border border-line-200 bg-surface-base rounded-control shrink-0 state-neutral"
            onClick={handleOpenRepo}
          >
            <span className="text-ink-600">
              <IconBrandGithub size={14} stroke={2} />
            </span>
            <span className="text-ink-700 text-body/[1.4167] font-medium">
              GitHub 仓库
            </span>
          </button>
        </>
      )
    }
  ]

  return (
    <div className="w-full flex flex-col gap-3 py-5 px-7 bg-canvas">
      <div className="flex items-center gap-3">
        <BackButton onClick={handleBack} />
        <div className="flex-1 flex flex-col gap-.75">
          {/* 18/26 是设计稿的一次性数值、没走 --font-size-* 令牌，但同样要跟着字号缩放
              走（否则缩放拉到 130% 时这个标题会显得偏小）。见 global.css 的 .page-title */}
          <h1 className="page-title font-bold text-ink-900">设置</h1>
          <p className="text-caption/[1.4545] font-normal text-ink-400">
            偏好设置修改后立即生效
          </p>
        </div>
        <span className="shrink-0 py-[1px] px-2.25 border border border-line-200 bg-surface-base rounded-pill text-caption/[1.4545] text-ink-500">
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
