// Easy2Send · 网页上传页交互
// 对应设计稿「07 网页上传 · 手机端」五屏状态：
//   配对中 / 已连接 / 上传中 / 上传完成 / 配对失败
//
// 所有可见性都由 render(state) 一个函数决定，避免五六处各改一半导致状态错位。

// 配对 token 从 URL fragment（#token=…）读取，不走 query（?token=…）。
// fragment 不会被浏览器发往服务器：既不进服务端访问日志，也不会出现在
// 样式表 / 脚本这类同源请求的 Referer 里（query 形态这两处都会把 token 带出去）。
// 读出后立刻抹掉 hash：地址栏、浏览器历史、随手截屏里都不再留痕。
// 抹的是 URL 而不是内存里的 pairToken —— 配对失败后点「重试」照旧能用。
function readPairToken() {
  const raw = window.location.hash.slice(1)
  if (!raw) return null
  const token = new URLSearchParams(raw).get('token')
  if (!token) return null
  try {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search
    )
  } catch (e) {
    // 极少数 WebView 会禁用 replaceState：读到 token 更要紧，放弃抹除即可
  }
  return token
}

const pairToken = readPairToken()

const els = {
  tagline: document.getElementById('tagline'),
  stateCard: document.getElementById('stateCard'),
  stateTitle: document.getElementById('stateTitle'),
  stateHint: document.getElementById('stateHint'),
  doneCard: document.getElementById('doneCard'),
  doneTitle: document.getElementById('doneTitle'),
  doneHint: document.getElementById('doneHint'),
  fileList: document.getElementById('fileList'),
  uploadArea: document.getElementById('uploadArea'),
  retryBtn: document.getElementById('retryBtn'),
  pickBtn: document.getElementById('pickBtn'),
  fileInput: document.getElementById('fileInput'),
  metaNote: document.getElementById('metaNote'),
  fileItemTemplate: document.getElementById('fileItemTemplate'),
  themeToggle: document.getElementById('themeToggle')
}

const TAGLINE_DEFAULT = '扫码访问，文件直达电脑'
const META_DEFAULT = '单文件最大 10GB'

let sessionToken = null

// ---------- 主题三态（跟随系统 / 浅色 / 深色） ----------
// 「跟随系统」时刻意**不写** data-theme，交给 style.css 的 media 查询去决定，
// 这样即使这段脚本没跑起来（或 localStorage 被禁用），页面也仍能正确跟随系统。

const THEME_KEY = 'e2s-theme'
const THEME_ORDER = ['system', 'light', 'dark']
const THEME_COLOR = { light: '#ffffff', dark: '#0f1218' }

const systemPrefersDark = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches

function readThemeMode() {
  const saved = localStorage.getItem(THEME_KEY)
  // 兜底：值被改坏或来自更早版本时，回到跟随系统
  return THEME_ORDER.includes(saved) ? saved : 'system'
}

function applyTheme(mode) {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = mode

  // theme-color 要按"最终生效"的主题算，不能按模式算 —— 跟随系统时它取决于
  // 系统偏好，所以这里重新问一次 matchMedia，不复用上面的判断。
  const isDark = mode === 'dark' || (mode === 'system' && systemPrefersDark())
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', isDark ? THEME_COLOR.dark : THEME_COLOR.light)
  }
}

function cycleTheme() {
  const mode = readThemeMode()
  const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length]
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch (e) {
    // 隐私模式下写不进去：本次切换照样生效，只是刷新后回到系统
  }
  applyTheme(next)
}

els.themeToggle?.addEventListener('click', cycleTheme)

// 跟随系统时，系统切了要刷新 theme-color（data-theme 本就不存在，无需改它）。
// addEventListener 在旧 WebView 上可能没有，退回已废弃但广泛的 addListener。
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const onSystemThemeChange = () => {
  if (readThemeMode() === 'system') applyTheme('system')
}
if (darkQuery.addEventListener) {
  darkQuery.addEventListener('change', onSystemThemeChange)
} else if (darkQuery.addListener) {
  darkQuery.addListener(onSystemThemeChange)
}

// data-theme 首屏已由 index.html 的内联脚本写好（否则会闪一帧浅色），
// 这里只补 theme-color 与按钮图标状态。
applyTheme(readThemeMode())

function show(el, visible) {
  el.classList.toggle('is-hidden', !visible)
}

/**
 * 渲染指定状态。
 * @param {'pairing'|'connected'|'uploading'|'done'|'failed'|'partial'} state
 * @param {{title?: string, hint?: string, tagline?: string, note?: string}} [copy]
 */
function render(state, copy = {}) {
  els.tagline.textContent = copy.tagline || TAGLINE_DEFAULT
  els.metaNote.textContent = copy.note || META_DEFAULT

  els.stateCard.classList.toggle('is-success', state === 'connected')
  els.stateCard.classList.toggle('is-error', state === 'failed')
  els.stateTitle.textContent = copy.title || ''
  els.stateHint.textContent = copy.hint || ''

  show(
    els.stateCard,
    state === 'pairing' || state === 'connected' || state === 'failed'
  )
  show(els.doneCard, state === 'done')
  // 设计稿 W3（上传中）没有画按钮：那是靠"一次多选"排队的。
  // 但完成态 W4 的底部文案写着"可以继续选择文件上传"，所以那里必须留着按钮。
  // partial 是上传有失败——设计稿没画这一屏，保留列表 + 按钮让用户能重试。
  show(els.fileList, state === 'uploading' || state === 'partial')
  show(
    els.uploadArea,
    state === 'connected' || state === 'done' || state === 'partial'
  )
  show(els.retryBtn, state === 'failed')
}

// ---------- 配对流程 ----------

async function pair() {
  if (!pairToken) {
    render('failed', { title: '缺少配对凭证', hint: '请重新扫描二维码' })
    return
  }

  render('pairing', {
    title: '正在配对...',
    hint: '请稍候，正在与电脑建立连接'
  })

  try {
    const resp = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pairToken })
    })

    if (!resp.ok) {
      const msg = await resp.text()
      render('failed', {
        title: '配对失败',
        hint: msg || '配对凭证已过期，请在电脑上重新生成二维码'
      })
      return
    }

    const data = await resp.json()
    sessionToken = data.session
    render('connected', {
      title: '已连接到电脑',
      hint: '选择文件开始上传'
    })
  } catch (e) {
    render('failed', { title: '网络错误', hint: e.message })
  }
}

// ---------- 文件上传 ----------

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'
  return (bytes / 1073741824).toFixed(2) + ' GB'
}

function createFileItem(name, size) {
  const item = els.fileItemTemplate.content.firstElementChild.cloneNode(true)
  item.querySelector('.file-item-name').textContent = name
  const status = item.querySelector('.file-item-status')
  // 模板默认就是"等待中"形态
  status.textContent = '等待上传 · ' + formatSize(size)
  els.fileList.appendChild(item)
  return {
    item,
    fill: item.querySelector('.file-item-bar-fill'),
    status
  }
}

function uploadFile(file) {
  return new Promise(resolve => {
    const ui = createFileItem(file.name, file.size)

    const formData = new FormData()
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.setRequestHeader('Authorization', 'Bearer ' + sessionToken)
    xhr.setRequestHeader('X-File-Size', file.size.toString())

    const settle = (ok, text) => {
      ui.item.classList.remove('is-waiting', 'is-uploading')
      ui.item.classList.add(ok ? 'is-done' : 'is-error')
      if (ok) {
        ui.fill.style.width = '100%'
        ui.status.textContent = '已完成 · ' + formatSize(file.size)
      } else {
        ui.status.textContent = text
      }
      resolve(ok)
    }

    // 上传进度（客户端已发送字节数 / 总字节数）
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable || e.total === 0) return
      const percent = (e.loaded / e.total) * 100
      ui.item.classList.remove('is-waiting')
      ui.item.classList.add('is-uploading')
      ui.fill.style.width = percent.toFixed(1) + '%'
      ui.status.textContent =
        formatSize(e.loaded) +
        ' / ' +
        formatSize(e.total) +
        ' · ' +
        percent.toFixed(1) +
        '%'
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(true)
      } else {
        settle(false, '上传失败: ' + (xhr.responseText || '未知错误'))
      }
    }

    xhr.onerror = () => settle(false, '上传失败: 网络错误')

    xhr.send(formData)
  })
}

async function uploadAll(files) {
  let done = 0
  let failed = 0
  let bytes = 0

  render('uploading', { tagline: '正在上传到电脑' })

  for (const file of files) {
    const ok = await uploadFile(file)
    if (ok) {
      done += 1
      bytes += file.size
    } else {
      failed += 1
    }
  }

  if (failed === 0) {
    els.doneTitle.textContent = done + ' 个文件已全部上传'
    els.doneHint.textContent = '共 ' + formatSize(bytes) + ' · 已保存到电脑'
    render('done', { tagline: '全部上传完成', note: '可以继续选择文件上传' })
  } else {
    render('partial', { tagline: '部分文件上传失败' })
  }
}

els.fileInput.addEventListener('change', async e => {
  const files = Array.from(e.target.files)
  els.fileInput.value = ''
  if (files.length === 0) return
  await uploadAll(files)
})

els.pickBtn.addEventListener('click', () => els.fileInput.click())

// 失败后重试：token 若真过期会再次失败，但网络抖动这种情况能直接救回来
els.retryBtn.addEventListener('click', () => {
  pair()
})

// 启动配对
pair()
