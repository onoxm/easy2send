/**
 * 压缩 src-tauri/web 下的 HTML/CSS/JS 源文件，
 * 将产物输出到 src-tauri/src/webupload（供 server.rs 通过 include_str! 嵌入二进制）。
 *
 * 工具链：
 *   HTML → html-minifier-terser
 *   JS   → terser
 *   CSS  → lightningcss
 *
 * 用法：pnpm minify:web
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { minify as terserMinify } from 'terser'
import { transform as lightningTransform } from 'lightningcss'
import { minify as htmlMinify } from 'html-minifier-terser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const SRC_DIR = join(ROOT, 'src-tauri', 'web')
const OUT_DIR = join(ROOT, 'src-tauri', 'src', 'webupload')

const FILES = [
  { name: 'index.html', type: 'html' },
  { name: 'script.js', type: 'js' },
  { name: 'style.css', type: 'css' }
]

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function minifyHtml(code) {
  return htmlMinify(code, {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeEmptyAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
    sortAttributes: true,
    sortClassName: true,
    minifyCSS: true,
    minifyJS: { compress: true, mangle: true }
  })
}

async function minifyJs(code) {
  const result = await terserMinify(code, {
    compress: {
      drop_console: false,
      drop_debugger: true,
      passes: 3, // 多轮压缩，提高控制流/死代码消除效果
      sequences: true, // 用逗号运算符合并多个简单语句
      conditionals: true, // 优化 if/else 控制流
      booleans: true, // 简化布尔表达式
      unused: true, // 删除未使用变量
      if_return: true, // 优化 if 后的 return
      join_vars: true, // 合并连续 var 声明
      negate_iife: true, // 否定立即执行函数以减少括号
      side_effects: true, // 删除无副作用的语句
      switches: true, // 优化 switch
      loops: true, // 优化循环
      typeofs: true, // 简化 typeof 比较
      comparisons: true // 简化比较表达式
    },
    mangle: {
      toplevel: true, // 混淆顶层变量名（包括全局作用域）
      eval: true, // 混淆 eval 作用域可见的变量
      properties: false, // 不混淆属性名（会破坏 DOM/fetch API 调用）
      reserved: ['$sessionToken', '$pairToken'] // 保留不混淆的标识符（如有需要在此追加）
    },
    format: {
      comments: false,
      ecma: 2020
    },
    ecma: 2020,
    keep_classnames: false, // 混淆 class 名
    keep_fnames: false // 混淆函数名
  })
  if (!result.code) throw new Error('terser 未产出代码')
  return result.code
}

function minifyCss(code) {
  const { code: out } = lightningTransform({
    filename: 'style.css',
    minify: true,
    sourceMap: false,
    code: Buffer.from(code, 'utf-8')
  })
  return out.toString('utf-8')
}

async function main() {
  console.log('[minify-web] 开始压缩 src-tauri/web → src-tauri/src/webupload')
  mkdirSync(OUT_DIR, { recursive: true })

  for (const { name, type } of FILES) {
    const srcPath = join(SRC_DIR, name)
    const outPath = join(OUT_DIR, name)
    const src = readFileSync(srcPath, 'utf-8')
    const before = Buffer.byteLength(src, 'utf-8')

    let out
    if (type === 'html') out = await minifyHtml(src)
    else if (type === 'js') out = await minifyJs(src)
    else if (type === 'css') out = minifyCss(src)
    else throw new Error(`未知文件类型: ${type}`)

    writeFileSync(outPath, out, 'utf-8')
    const after = Buffer.byteLength(out, 'utf-8')
    const ratio = before > 0 ? ((1 - after / before) * 100).toFixed(1) : '0'
    console.log(
      `  ${name}: ${fmtSize(before)} → ${fmtSize(after)} (-${ratio}%)`
    )
  }

  console.log('[minify-web] 完成')
}

main().catch(e => {
  console.error('[minify-web] 失败:', e)
  process.exit(1)
})
