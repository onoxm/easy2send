; Easy2Send NSIS 安装器 Hook
; 放行两类入站流量：
;   UDP 5353    — mDNS 多播（设备发现）
;   TCP 8000-9000 — 文件传输（接收端监听端口范围）
;
; 权限说明：netsh advfirewall 需要管理员权限。
; - installMode = "perMachine" 时安装器已提权，规则可直接生效。
; - installMode = "currentUser"（Tauri 默认）时安装器无 admin，
;   netsh 会静默失败（不阻断安装），需改 installMode 或在应用内引导用户放行。

!macro NSIS_HOOK_POSTINSTALL
  ; 先删除可能存在的旧规则（幂等，避免升级安装产生重复规则）
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Easy2Send mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Easy2Send Transfer"'
  ; 添加入站规则：UDP 5353（mDNS 标准端口）
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Easy2Send mDNS" dir=in action=allow protocol=UDP localport=5353'
  ; 添加入站规则：TCP 8000-9000（文件传输端口范围）
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Easy2Send Transfer" dir=in action=allow protocol=TCP localport=8000-9000'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 卸载时移除防火墙规则
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Easy2Send mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Easy2Send Transfer"'
!macroend
