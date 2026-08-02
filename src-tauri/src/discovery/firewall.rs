//! Windows 防火墙规则管理
//!
//! 仅放行 UDP 5353（mDNS 多播）。
//! TCP 文件传输端口依赖 Windows「应用首次监听」弹窗机制：
//! 应用调用 TcpListener::bind 时 Windows 自动弹窗，用户点「允许访问」即可。
//!
//! 非 Windows 平台（macOS / Linux）默认放行，无需配置。

/// 检测 "Easy2Send mDNS" 防火墙规则是否存在
///
/// Windows：执行 `netsh advfirewall firewall show rule`，exit code 0 表示存在。
/// 非 Windows：直接返回 true。
pub async fn check_rule() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("netsh")
            .args([
                "advfirewall",
                "firewall",
                "show",
                "rule",
                "name=Easy2Send mDNS",
            ])
            .output()
            .map_err(|e| format!("检测防火墙规则失败: {}", e))?;
        Ok(output.status.success())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(true)
    }
}

/// 提权添加 "Easy2Send mDNS" 防火墙规则（仅 UDP 5353）
///
/// TCP 端口不加 netsh 规则，依赖 Windows 弹窗机制（应用级规则）。
pub async fn ensure_rule() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if check_rule().await? {
            return Ok(());
        }

        let ps_script = "Start-Process -FilePath netsh -ArgumentList 'advfirewall firewall add rule name=\"Easy2Send mDNS\" dir=in action=allow protocol=UDP localport=5353' -Verb RunAs";

        std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", ps_script])
            .spawn()
            .map_err(|e| format!("启动提权进程失败: {}", e))?;

        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}
