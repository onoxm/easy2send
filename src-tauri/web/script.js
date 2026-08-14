// 从 URL query 取配对 token
const urlParams = new URLSearchParams(window.location.search)
const pairToken = urlParams.get('token')
let sessionToken = null

const statusBox = document.getElementById('statusBox')
const statusIcon = document.getElementById('statusIcon')
const statusText = document.getElementById('statusText')
const statusHint = document.getElementById('statusHint')
const uploadArea = document.getElementById('uploadArea')
const fileInput = document.getElementById('fileInput')
const fileList = document.getElementById('fileList')
const deviceInfo = document.getElementById('deviceInfo')

function setStatus(iconClass, text, hint) {
  statusIcon.className = 'status-icon ' + iconClass
  statusText.textContent = text
  if (hint) statusHint.textContent = hint
}

// ---------- 配对流程 ----------
async function pair() {
  if (!pairToken) {
    setStatus('error', '缺少配对凭证', '请重新扫描二维码')
    return
  }
  try {
    const resp = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pairToken })
    })
    if (!resp.ok) {
      const msg = await resp.text()
      setStatus('error', '配对失败', msg || '请重新扫描二维码')
      return
    }
    const data = await resp.json()
    sessionToken = data.session
    setStatus('success', '已连接到电脑', '选择文件开始上传')
    uploadArea.style.display = 'flex'
  } catch (e) {
    setStatus('error', '网络错误', e.message)
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
  const item = document.createElement('div')
  item.className = 'file-item'
  item.innerHTML = `
    <div class="file-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg></div>
    <div class="file-info">
      <div class="file-name">${name}</div>
      <div class="file-progress-bar"><div class="file-progress-fill" style="width:0%"></div></div>
      <div class="file-status">等待上传 · ${formatSize(size)}</div>
    </div>
  `
  fileList.appendChild(item)
  return {
    item,
    fill: item.querySelector('.file-progress-fill'),
    status: item.querySelector('.file-status')
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

    // 上传进度（客户端已发送字节数 / 总字节数）
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const percent = (e.loaded / e.total) * 100
        ui.fill.style.width = percent.toFixed(1) + '%'
        ui.status.textContent =
          formatSize(e.loaded) +
          ' / ' +
          formatSize(e.total) +
          ' · ' +
          percent.toFixed(1) +
          '%'
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        ui.fill.style.width = '100%'
        ui.status.className = 'file-status done'
        ui.status.textContent = '已完成 · ' + formatSize(file.size)
      } else {
        ui.status.className = 'file-status error'
        ui.status.textContent = '上传失败: ' + (xhr.responseText || '未知错误')
      }
      resolve()
    }

    xhr.onerror = () => {
      ui.status.className = 'file-status error'
      ui.status.textContent = '上传失败: 网络错误'
      resolve()
    }

    xhr.send(formData)
  })
}

fileInput.addEventListener('change', async e => {
  const files = Array.from(e.target.files)
  fileInput.value = ''
  for (const file of files) {
    await uploadFile(file)
  }
})

// 启动配对
pair()
