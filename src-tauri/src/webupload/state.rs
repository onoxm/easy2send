// 手机上传 HTTP 服务器的共享状态
//
// WebUploadState 由 run_server 创建，通过 Arc 同时被 axum handler 访问。
// create_pair_token 命令通过 WebUploadServerControl.web_state 间接访问。

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::sync::Mutex;

/// 配对 token 有效期（5 分钟）
const PAIR_TOKEN_TTL: Duration = Duration::from_secs(300);
/// session token 有效期（30 分钟）
const SESSION_TTL: Duration = Duration::from_secs(1800);
/// 同一桌面端最多并发 session 数
const MAX_SESSIONS: usize = 3;

/// axum 共享状态：注入到所有 handler
///
/// pair_token 同时只保留一个（桌面端只服务一个配对请求），
/// sessions 允许多个（手机可同时开多个上传连接）
pub struct WebUploadState {
    pub save_dir: PathBuf,
    pub app: AppHandle,
    pub pair_token: Mutex<Option<(String, Instant)>>,
    pub sessions: Mutex<HashMap<String, Instant>>,
}

impl WebUploadState {
    pub fn new(save_dir: PathBuf, app: AppHandle) -> Self {
        Self {
            save_dir,
            app,
            pair_token: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// 生成新的配对 token（覆盖旧的，同时只有一个有效）
    pub async fn create_pair_token(&self) -> String {
        let token = new_token();
        let now = Instant::now();
        let mut guard = self.pair_token.lock().await;
        *guard = Some((token.clone(), now));
        token
    }

    /// 校验配对 token：有效则销毁并返回 true，无效/过期返回 false
    pub async fn validate_and_consume_pair_token(&self, token: &str) -> bool {
        let mut guard = self.pair_token.lock().await;
        if let Some((stored, created_at)) = guard.take() {
            // token 匹配且未过期
            return stored == token && created_at.elapsed() < PAIR_TOKEN_TTL;
        }
        false
    }

    /// 签发 session token（配对成功后调用）
    pub async fn create_session(&self) -> String {
        let token = new_token();
        let now = Instant::now();
        let mut guard = self.sessions.lock().await;
        // 超过上限时清理最早的过期 session
        if guard.len() >= MAX_SESSIONS {
            guard.retain(|_, last_active| now.duration_since(*last_active) < SESSION_TTL);
        }
        guard.insert(token.clone(), now);
        token
    }

    /// 校验 session token：有效则续期并返回 true，无效/过期返回 false
    pub async fn validate_session(&self, token: &str) -> bool {
        let now = Instant::now();
        let mut guard = self.sessions.lock().await;
        if let Some(last_active) = guard.get_mut(token) {
            if now.duration_since(*last_active) < SESSION_TTL {
                *last_active = now; // 续期
                return true;
            }
            // 已过期，移除
            guard.remove(token);
        }
        false
    }
}

/// 生成随机 token：UUID v4（122 位随机性，足够防碰撞）
fn new_token() -> String {
    uuid::Uuid::new_v4().to_string()
}
