// 设备信任表
//
// 传输链路只接受「已受信任设备」的请求。这里存三样东西：
//   1. 信任名单 —— 用户确认过的设备，落盘到 app_data_dir/trusted_devices.json
//   2. 已知对端 —— 本机主动连过的设备及其证书指纹（只用于固定对端，不等于信任）
//   3. 待确认握手 —— 已弹出询问、正等用户点「接受/拒绝」的握手回传通道
//
// 为什么传输连接还要再查一次：握手（MODE_HANDSHAKE）和传输是**两条独立的
// TCP 连接**，握手那一关过了不代表传输这条连接可信。信任必须各自校验，
// 否则攻击者跳过握手直接建传输连接即可绕过。
//
// **身份凭据是证书指纹，不是 device_id。** device_id 通过 mDNS 明文广播，
// 同网段任何人读一下就能冒用；而指纹取自 TLS 握手中对端出示的自签证书，
// 想伪装就得先拿到对方的私钥。因此准入判定一律走指纹，device_id 只用于
// 展示、索引与「设置页里认出这是哪台设备」。

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::{oneshot, Mutex};

/// 信任表持久化文件名（存放在 app_data_dir 下）
const TRUST_FILE: &str = "trusted_devices.json";

/// 信任表结构版本
///
/// 2 = 记录中加入证书指纹（`fingerprint`）。version 1 的旧记录反序列化后指纹为空串，
/// 而空串不会匹配任何真实指纹 ⇒ 自动退化成「需要重新确认」。这正是引入加密链路时
/// 期望的行为：老记录没有可验证的身份信息，不能继续当作可信。
const TRUST_VERSION: u32 = 2;

pub type SharedTrustState = Arc<Mutex<TrustState>>;

/// 一条信任记录
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedDevice {
    pub device_id: String,
    pub device_name: String,
    /// 对端自签证书的 SHA-256 指纹（小写十六进制）
    ///
    /// `serde(default)` 是为了兼容升级前写下的旧记录：那些记录没有这个字段，
    /// 读出来是空串，于是查表时永远不命中，用户会被重新问一次。
    #[serde(default)]
    pub fingerprint: String,
    /// 首次确认时间（Unix 毫秒）
    pub first_seen: u64,
    /// 最近一次通过校验的时间（Unix 毫秒）
    pub last_seen: u64,
}

/// 落盘结构（数组而非 map，便于将来加字段）
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustFile {
    version: u32,
    devices: Vec<TrustedDevice>,
    /// 已知对端指纹：device_id -> 证书指纹
    ///
    /// 刻意与 `devices` 分开：`devices` 表示「我允许它连入本机」，
    /// 而这里只表示「我主动连过它、记得它长什么样」。见 `remember_peer`。
    #[serde(default)]
    known_peers: HashMap<String, String>,
}

pub struct TrustState {
    path: PathBuf,
    trusted: HashMap<String, TrustedDevice>,
    /// 已知对端指纹（不含准入语义，只用于固定对端证书）
    known_peers: HashMap<String, String>,
    /// 已弹出询问、等待用户决策的握手：device_id -> 结果回传通道
    pending: HashMap<String, oneshot::Sender<bool>>,
}

impl TrustState {
    /// 读取信任表。文件缺失或损坏时按「空表」处理——最坏结果是已信任设备需要重新确认，
    /// 不会影响启动，也不会误放行。
    pub fn load(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_data_dir()
            .map(|dir| dir.join(TRUST_FILE))
            .unwrap_or_else(|_| PathBuf::from(TRUST_FILE));

        let (trusted, known_peers) = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<TrustFile>(&text).ok())
            .map(|file| {
                let trusted = file
                    .devices
                    .into_iter()
                    .map(|d| (d.device_id.clone(), d))
                    .collect::<HashMap<_, _>>();
                (trusted, file.known_peers)
            })
            .unwrap_or_default();

        Self {
            path,
            trusted,
            known_peers,
            pending: HashMap::new(),
        }
    }

    /// 落盘。信任表只有几十条，同步写足够快，避免持锁期间引入 await。
    fn save(&self) -> Result<()> {
        let file = TrustFile {
            version: TRUST_VERSION,
            devices: self.trusted.values().cloned().collect(),
            known_peers: self.known_peers.clone(),
        };
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.path, serde_json::to_string_pretty(&file)?)?;
        Ok(())
    }

    // ---------- 信任名单（准入判定） ----------

    /// 按证书指纹查信任记录
    ///
    /// 指纹为空直接判否：没走过 TLS 的连接、或升级前的旧记录，都不该被当成可信。
    pub fn find_by_fingerprint(&self, fingerprint: &str) -> Option<&TrustedDevice> {
        if fingerprint.is_empty() {
            return None;
        }
        self.trusted
            .values()
            .find(|d| !d.fingerprint.is_empty() && d.fingerprint == fingerprint)
    }

    /// 该证书指纹是否已在信任名单里
    pub fn is_trusted_fingerprint(&self, fingerprint: &str) -> bool {
        self.find_by_fingerprint(fingerprint).is_some()
    }

    /// 记入信任名单（以 device_id 为键）
    ///
    /// 已存在则更新名称、指纹与最近时间，保留最初的 first_seen；指纹也会被覆盖——
    /// 同一台设备重装应用会生成新密钥对，旧指纹必须让位给新的，否则它会永远连不上。
    pub fn trust(
        &mut self,
        device_id: &str,
        device_name: &str,
        fingerprint: &str,
        now: u64,
    ) -> Result<()> {
        match self.trusted.get_mut(device_id) {
            Some(existing) => {
                existing.device_name = device_name.to_string();
                existing.fingerprint = fingerprint.to_string();
                existing.last_seen = now;
            }
            None => {
                self.trusted.insert(
                    device_id.to_string(),
                    TrustedDevice {
                        device_id: device_id.to_string(),
                        device_name: device_name.to_string(),
                        fingerprint: fingerprint.to_string(),
                        first_seen: now,
                        last_seen: now,
                    },
                );
            }
        }
        self.save()
    }

    /// 已信任设备再次连入：刷新最近时间，并在**名字变了**时同步更新
    ///
    /// 名字以「最近一次连接时对端自述的名字」为准。指纹一致就说明还是同一台机器，
    /// 改名纯属展示层的事；但信任表里那份名字必须跟着走，否则设置页的「已信任设备」
    /// 会永远停在首次确认时的名字，和用户在首页/传输页看到的对不上。
    ///
    /// 只有名字真的变化才落盘：改名是低频事件，而 `last_seen` 属于高频低价值变更，
    /// 仍然只更新内存。落盘失败不阻断连接 —— 名字陈旧远比连不上轻。
    pub fn touch_fingerprint(&mut self, fingerprint: &str, device_name: &str, now: u64) {
        if fingerprint.is_empty() {
            return;
        }

        // 把 entry 的可变借用限制在这个作用域内：`save()` 需要 `&self`，
        // 不能与 `&mut self.trusted` 同时存活。
        let renamed = {
            let entry = match self
                .trusted
                .values_mut()
                .find(|d| !d.fingerprint.is_empty() && d.fingerprint == fingerprint)
            {
                Some(e) => e,
                None => return,
            };
            entry.last_seen = now;

            // 空名字按「对端这次没报名字」处理，不覆盖已有记录：
            // 宁可留着旧名，也不要把它抹成空白。
            if device_name.is_empty() || entry.device_name == device_name {
                false
            } else {
                entry.device_name = device_name.to_string();
                true
            }
        };

        if renamed {
            if let Err(e) = self.save() {
                eprintln!("[trust] 已信任设备改名后落盘失败: {}", e);
            }
        }
    }

    /// 只刷新「最近通过校验的时间」，不涉及名字
    ///
    /// 给**没有名字可报**的路径用：传输连接的协议里就没有 `device_name` 字段
    /// （只有握手和断开才带），那里能确定的只是「这台设备刚用过本机」。
    ///
    /// 单独成一个方法而不是让调用方传空串：空串的语义（「这次没报名字」）藏在参数里
    /// 太容易被误用，而这条路径恰恰**绝不能**改名 —— 传输连接里唯一可得的身份是
    /// 自述的 `device_id`，任何人都能填，拿它去反查或写入信任表等于开后门。
    pub fn touch_last_seen(&mut self, fingerprint: &str, now: u64) {
        self.touch_fingerprint(fingerprint, "", now);
    }

    // ---------- 已知对端（只用于固定对端证书） ----------

    /// 记住一台本机主动连过的设备的证书指纹
    ///
    /// **这不是「信任」。** 区别很关键：`trust()` 表示「我允许它往本机写文件」，
    /// 而这里只表示「我发起到它的连接时，能认出是不是同一台机器」。混在一起会让
    /// 「连过对方一次」意外变成「同意对方连我」——方向完全不同，不能合并。
    pub fn remember_peer(&mut self, device_id: &str, fingerprint: &str) -> Result<()> {
        if device_id.is_empty() || fingerprint.is_empty() {
            return Ok(());
        }
        if self.known_peers.get(device_id).map(|f| f == fingerprint) == Some(true) {
            return Ok(()); // 没变化就不必落盘
        }
        self.known_peers
            .insert(device_id.to_string(), fingerprint.to_string());
        self.save()
    }

    /// 取本机记录的某台设备证书指纹，用于**主动连接时**固定对端（防中间人）
    ///
    /// 两个来源：已信任名单（用户确认过），以及「连过一次」的已知对端。
    /// 都没有就返回 None ⇒ 调用方按首次接触处理（不固定）。
    /// 旧记录（无指纹）同样返回 None。
    pub fn pinned_fingerprint_of(&self, device_id: &str) -> Option<String> {
        self.trusted
            .get(device_id)
            .map(|d| d.fingerprint.clone())
            .filter(|fp| !fp.is_empty())
            .or_else(|| self.known_peers.get(device_id).cloned())
    }

    /// 取消信任
    ///
    /// 撤销后对方下次连接会重新弹窗确认（它的指纹已不在名单里）。
    /// 注意这不是「拉黑」：当前阶段没有黑名单，被拒绝过的设备依然可以再次发起请求。
    pub fn revoke(&mut self, device_id: &str) -> Result<bool> {
        let removed = self.trusted.remove(device_id).is_some();
        if removed {
            self.save()?;
        }
        Ok(removed)
    }

    /// 按最近时间倒序列出信任设备（设置页「已信任设备」）
    pub fn list(&self) -> Vec<TrustedDevice> {
        let mut list: Vec<TrustedDevice> = self.trusted.values().cloned().collect();
        list.sort_by(|a, b| b.last_seen.cmp(&a.last_seen));
        list
    }

    // ---------- 待确认握手 ----------

    /// 登记一次等待用户决策的握手，返回接收端要 await 的通道。
    /// 同一设备重复发起时丢弃旧的：旧请求会因 sender 被覆盖而立刻收到 Err，按拒绝处理。
    pub fn register_pending(&mut self, device_id: &str) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        self.pending.insert(device_id.to_string(), tx);
        rx
    }

    /// 前端提交决策：取出并唤醒等待中的握手，返回是否确实有挂起的请求
    pub fn resolve_pending(&mut self, device_id: &str, accepted: bool) -> bool {
        match self.pending.remove(device_id) {
            Some(tx) => tx.send(accepted).is_ok(),
            None => false,
        }
    }

    /// 等待超时后清理挂起项；前端若之后再点「接受」，会被判为无挂起请求
    pub fn cancel_pending(&mut self, device_id: &str) {
        self.pending.remove(device_id);
    }
}

// ---------- Tauri 命令（设置页「已信任设备」） ----------

/// 列出已信任设备，按最近通过校验的时间倒序
#[tauri::command]
pub async fn list_trusted_devices(
    trust_state: tauri::State<'_, SharedTrustState>,
) -> Result<Vec<TrustedDevice>, String> {
    let t = trust_state.lock().await;
    Ok(t.list())
}

/// 取消某台设备的信任，返回是否确实删掉了一条记录
///
/// 撤销不等于拉黑：对方下次再来连接会重新走弹窗确认。当前阶段没有黑名单，
/// 被拒绝过的设备依然可以再次发起请求。
#[tauri::command]
pub async fn revoke_trusted_device(
    device_id: String,
    trust_state: tauri::State<'_, SharedTrustState>,
) -> Result<bool, String> {
    let mut t = trust_state.lock().await;
    t.revoke(&device_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// 造一个把信任表写在临时目录里的实例（每个用例独立目录，避免相互干扰）
    fn temp_state(tag: &str) -> TrustState {
        let dir = std::env::temp_dir().join(format!("e2s-trust-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        TrustState {
            path: dir.join(TRUST_FILE),
            trusted: HashMap::new(),
            known_peers: HashMap::new(),
            pending: HashMap::new(),
        }
    }

    /// 已信任设备改名后再连：信任表里的名字以**最新一次连接**为准，且真的落盘
    #[test]
    fn trusted_device_rename_follows_latest_connection() {
        let mut st = temp_state("rename");
        st.trust("dev-1", "旧名字", "fp-aaa", 1_000).expect("写入信任表失败");

        // 同一指纹、新名字：模拟对端改了别名之后再连一次
        st.touch_fingerprint("fp-aaa", "新名字", 2_000);

        let d = st.find_by_fingerprint("fp-aaa").expect("指纹应仍然命中");
        assert_eq!(d.device_name, "新名字", "名字应以最新一次连接为准");
        assert_eq!(d.last_seen, 2_000, "最近连接时间应被刷新");

        // 落盘验证：load() 需要 AppHandle 拿不到，所以直接读文件 ——
        // 没落盘的话重启就退回旧名字，这正是要在用例里钉住的
        let text = std::fs::read_to_string(&st.path).expect("信任表应已落盘");
        assert!(text.contains("新名字"), "改名后必须落盘: {}", text);
    }

    /// 名字没变时不落盘：删掉文件后同名连接不应把它写回来
    #[test]
    fn touch_without_rename_does_not_write_disk() {
        let mut st = temp_state("no-rename");
        st.trust("dev-1", "名字甲", "fp-bbb", 1_000).expect("写入信任表失败");
        std::fs::remove_file(&st.path).expect("前置条件：信任表文件应已生成");

        st.touch_fingerprint("fp-bbb", "名字甲", 2_000);

        assert!(
            !st.path.exists(),
            "名字未变化时不该落盘（last_seen 属高频低价值变更，只更新内存）"
        );
        assert_eq!(
            st.find_by_fingerprint("fp-bbb").unwrap().last_seen,
            2_000,
            "内存里的最近时间仍应刷新"
        );
    }

    /// 对端这次没报名字（空串）时，不该把已记录的名字抹掉
    #[test]
    fn empty_name_does_not_erase_existing() {
        let mut st = temp_state("empty-name");
        st.trust("dev-1", "名字甲", "fp-ccc", 1_000).expect("写入信任表失败");

        st.touch_fingerprint("fp-ccc", "", 2_000);

        assert_eq!(
            st.find_by_fingerprint("fp-ccc").unwrap().device_name,
            "名字甲",
            "空名字应视为「这次没报」，而非「名字变成了空」"
        );
    }
}
