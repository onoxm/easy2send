import {
  checkFirewallRule,
  connectDevice,
  ensureFirewallRule,
} from "@/api/discovery";
import { createNewWindow } from "@/api/tauri";
import { Layout } from "@/components";
import { useDevices } from "@/hooks";
import useStore from "@/store";
import { platformIcon } from "@/types/discovery";
import { SettingTwo } from "@icon-park/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

export default () => {
  const { devices, refresh } = useDevices();
  const navigate = useNavigate();
  const deviceName = useStore("deviceName");

  // 防火墙引导：null=检测中, true=已放行, false=需引导
  const [firewallOk, setFirewallOk] = useState<boolean | null>(null);
  const [allowing, setAllowing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  // 检测防火墙规则是否存在（仅 Windows 需要引导，非 Windows 恒 true）
  useEffect(() => {
    checkFirewallRule()
      .then(setFirewallOk)
      .catch(() => setFirewallOk(true));
  }, []);

  // 一键放行：提权添加规则，等待 UAC 确认后重新检测
  const handleAllowFirewall = async () => {
    setAllowing(true);
    try {
      await ensureFirewallRule();
      setTimeout(async () => {
        try {
          setFirewallOk(await checkFirewallRule());
        } catch {
          /* ignore */
        }
        setAllowing(false);
      }, 3000);
    } catch (e) {
      setAllowing(false);
      console.error("ensure firewall failed:", e);
    }
  };

  // 点击设备 → 发送握手 → 跳转传输页
  const handleConnect = async (deviceId: string) => {
    setConnecting(deviceId);
    try {
      const peer = await connectDevice(deviceId);
      useStore.setState({ connectedDevice: peer });
      navigate("/transfer");
    } catch (error) {
      alert(`连接失败: ${error}`);
    } finally {
      setConnecting(null);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col gap-4 w-full flex-1 justify-center items-center relative p-6">
        {/* 设置按钮 */}
        <button
          className="little_btn absolute top-2 right-2"
          onClick={() => {
            createNewWindow("settings", {
              url: "/settings",
              width: 600,
              height: 500,
            });
          }}
        >
          <SettingTwo theme="outline" size={20} fill="#333" strokeWidth={3} />
        </button>

        {/* 标题 */}
        <div className="text-center">
          <h2 className="text-xl font-bold mb-1">Easy2Send</h2>
          <p className="text-sm text-gray-500">
            {deviceName || "..."} · 点击设备开始互传
          </p>
        </div>

        {/* 防火墙警告 */}
        {firewallOk === false && (
          <div className="w-full max-w-md p-3 border border-yellow-400 bg-yellow-50 rounded-md text-sm flex items-center justify-between">
            <span>⚠️ 防火墙未放行 mDNS，其他设备可能无法发现你</span>
            <button
              className="bg-yellow-500 text-white px-3 py-1 rounded cursor-pointer disabled:opacity-50"
              onClick={handleAllowFirewall}
              disabled={allowing}
            >
              {allowing ? "等待确认..." : "一键放行"}
            </button>
          </div>
        )}

        {/* 设备列表 */}
        <div className="w-full max-w-md">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-600">
              在线设备（{devices.length}）
            </span>
            <button
              className="text-xs text-blue-500 hover:underline cursor-pointer"
              onClick={refresh}
            >
              刷新
            </button>
          </div>

          {devices.length === 0 ? (
            <div className="text-center text-gray-400 py-8 border border-dashed rounded-md">
              暂无在线设备，请确认其他设备已启动 Easy2Send
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {devices.map((d) => (
                <button
                  key={d.deviceId}
                  className="flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
                  onClick={() => handleConnect(d.deviceId)}
                  disabled={connecting !== null}
                >
                  <span className="text-2xl">{platformIcon[d.platform]}</span>
                  <div className="flex-1 text-left">
                    <div className="font-medium">{d.deviceName}</div>
                    <div className="text-xs text-gray-500">
                      {d.ip}:{d.port} · {d.platform} · v{d.version}
                    </div>
                  </div>
                  {connecting === d.deviceId && (
                    <span className="text-xs text-blue-500">连接中...</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};
