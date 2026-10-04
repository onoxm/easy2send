# easy2send

## 0.3.1

### Patch Changes

- 修复 localStorage 里遗留的旧格式记录把全部持久化字段覆盖成 undefined，导致界面文字消失、设置页报错的问题
- 移除已无引用的 zustand 依赖（状态管理迁移至 ono-react-element 的 defineGlobalState 后遗留）

## 0.3.0

### Minor Changes

- 破坏性变更：状态管理迁移至 ono-react-element 的 defineGlobalState 与 persistMiddleware，本地偏好的持久化键由 ono-storage 改为 easy2send。升级后主题、保存路径、设备别名、并发数与字体等设置不会被读取，需要重新设置一次。
- 新增界面字体与字号设置，可选择字体家族，并按百分比缩放界面字号。
- 新增手动连接弹窗，可手工输入设备地址与端口建立连接。
- 界面按设计稿整体重做：引入 CSS 设计令牌（颜色、圆角、字阶、阴影），首页、传输页、扫描传输页、设置页、更新弹窗与扫描弹窗全部更新；补充 hover / active / focus 等交互态样式；新增主题切换按钮，支持浅色、深色与跟随系统三种模式。

### Patch Changes

- 升级 ono-react-element 至 0.6.1 并同步适配其组件 API（提示气泡改用 Tooltip、下拉框改用子函数渲染选项）；移除 @onoxm/zustand-tools 依赖。
- 引入 husky 与 lint-staged，提交前自动执行格式化；补充应用元信息（应用描述、MIT 协议、仓库地址）与 Android、iOS 平台图标。

## 0.2.10

### Patch Changes

- 增加点击系统提示跳转至软件功能

## 0.2.9

### Patch Changes

- 修复设置页也会跳转到传输页的问题
- 使用自定义 hook 封装 Tauri 的 listen 事件，并增加 macOS 与 Linux 的系统提示音

## 0.2.8

### Patch Changes

- 修复虚拟列表的显示问题，并增加 Web 端辅助接收

## 0.2.7

### Patch Changes

- 优化虚拟列表性能

## 0.2.6

### Patch Changes

- 优化软件界面
- 不再限制 pnpm 版本

## 0.2.5

### Patch Changes

- 优化交互体验

## 0.2.4

### Patch Changes

- 优化设备搜索与传输界面

## 0.2.3

### Patch Changes

- 支持拖拽传输文件

## 0.2.2

### Patch Changes

- 优化设备发现体验
- 重构传输界面与功能

## 0.2.1

### Patch Changes

- 优化部分界面与功能

## 0.2.0

### Minor Changes

- 完成软件自动检测更新功能

## 0.1.12

### Patch Changes

- 新增更新软件按钮

## 0.1.11

### Patch Changes

- 优化发布工作流

## 0.1.10

### Patch Changes

- 优化发布工作流

## 0.1.9

### Patch Changes

- 优化下载进度条

## 0.1.8

### Patch Changes

- 更新弹窗只出现一次

## 0.1.7

### Patch Changes

- 测试更新功能

## 0.1.6

### Patch Changes

- 优化更新界面

## 0.1.5

### Patch Changes

- 测试自动更新功能

## 0.1.4

### Patch Changes

- 调整更新弹窗说明，并测试下载新版本

## 0.1.3

### Patch Changes

- 测试自动更新功能

## 0.1.2

### Patch Changes

- 增加自动更新功能
- 将打包产物上传到公开仓库
- 让工作流升级到 Node.js v24

## 0.1.1

### Patch Changes

- 完成基本的文件收发功能

## 0.1.0

### Minor Changes

- 项目初始化
