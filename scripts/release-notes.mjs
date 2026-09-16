#!/usr/bin/env node
// 生成当前版本的更新说明：取「上一个 tag..HEAD」之间的提交标题，输出到 stdout。
//
// 用途：CI 把它写进 GitHub Release 的 body；tauri-action 会把这个 body 原样带进
// latest.json 的 notes 字段，最终出现在应用内的更新弹窗里（见 UpdateDialog.tsx）。
//
// 前提：仓库必须是完整历史。actions/checkout 默认 fetch-depth: 1 只取单个提交、
// 不带 tag，range 会取空，所以工作流里必须显式 fetch-depth: 0。
//
// 用 Node 而不是 sed/awk，是因为要按 Unicode 属性剥 emoji：\p{Extended_Pictographic}
// 在 macOS 自带的 BSD sed / awk 上不支持，同一套正则在本地与 CI 上会行为不一致。
import { execFileSync } from 'node:child_process'

const TAG = process.env.TAG || process.env.GITHUB_REF_NAME || ''

const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

// 上一个 tag 按版本号排序取，不能用 creatordate —— 本仓库的 tag 都由 gh 建在相近的
// 提交上，日期完全可能相同，排序结果不可靠。
let prev = ''
try {
  const tags = git('tag', '--sort=-v:refname')
    .split('\n')
    .map(t => t.trim())
    .filter(Boolean)
  prev = tags.find(t => t !== TAG) ?? ''
} catch {
  prev = ''
}

const range = prev ? `${prev}..HEAD` : 'HEAD'

// 剥掉 conventional-commit 前缀（type / type(scope) / 带 ! 的破坏性标记），保留描述。
const stripType = s => s.replace(/^[a-zA-Z]+(\([^)]*\))?!?:\s*/, '')
// 剥掉行首 emoji。设计稿规范不允许文本节点含 emoji（应改用图标），且带变体选择符的
// emoji 在部分 Linux 发行版上会渲染成豆腐块，说明文字对终端用户应保持纯文本。
const stripEmoji = s =>
  s.replace(
    /^(?:[\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]+\s*)+/u,
    ''
  )

const items = git('log', range, '--no-merges', '--pretty=tformat:%s')
  .split('\n')
  .map(s => stripEmoji(stripType(s)).trim())
  .filter(Boolean)
  .map(s => `- ${s}`)

const notes = items.length ? items.join('\n') : '本次更新包含若干修复与优化。'
process.stdout.write(`${notes}\n`)
