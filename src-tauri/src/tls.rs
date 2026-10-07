//! 传输链路加密与设备身份
//!
//! 三件事合在这一层：**机密性**（TLS 1.3 加密所有流量）、**完整性**（AEAD 自带）、
//! **身份认证**（自签证书的 SHA-256 指纹）。
//!
//! ## 为什么是指纹而不是 device_id
//!
//! `device_id` 通过 mDNS TXT 明文广播，同网段任何人读一下就能冒用——它只能算个名字。
//! 指纹取自对端在 TLS 握手里出示的证书，想伪装就得先拿到对方的私钥。所以
//! 信任表按指纹查（见 `trust.rs`），`device_id` 退化为展示用的标签。
//!
//! ## 信任怎么建立（TOFU）
//!
//! 首次接触时双方都没有对方的指纹，TLS 层无从判断，于是：
//!   - 服务端用 [`AcceptAnyClientCert`] 接受任意客户端证书（但仍强制客户端出示，并验证其签名）
//!   - 客户端用 [`PinnedServerCert`] 在**有记录时**要求指纹完全匹配，没记录则放行
//!
//! 真正的准入判定放在应用层：拿握手里取到的指纹去查信任表，命中才收文件，
//! 未命中就走用户确认弹窗（确认后指纹入库，此后静默）。这样「首次的信任」始终
//! 来自用户的一次明确点击，而不是来自网络上的任何声明。
//!
//! ## 证书为什么不校验链、也不设有效期压力
//!
//! 自签证书没有可用的信任锚，链式校验在此毫无意义——身份是被**比对**出来的，
//! 不是**推导**出来的。有效期同理：它由本机生成、本机消费，设成固定的百年窗口
//! 反而消除了「两台设备系统时钟不同步导致握手失败」这类问题。

use anyhow::{anyhow, Context, Result};
use rcgen::{date_time_ymd, CertificateParams, KeyPair, PKCS_ECDSA_P256_SHA256};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{
    ClientConfig, DigitallySignedStruct, DistinguishedName, Error as TlsError, ServerConfig,
    SignatureScheme,
};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_rustls::{TlsAcceptor, TlsConnector};

/// TCP 建连超时（秒）
///
/// 多网卡环境下候选地址可能不可达，建连单独限时，免得一个死地址把整个等待窗口耗光。
const CONNECT_TIMEOUT_SECS: u64 = 3;

/// TLS 握手超时（秒）
///
/// 服务端也用它兜底：慢速或半开的连接不能把 accept 循环拖住。
pub const TLS_HANDSHAKE_TIMEOUT_SECS: u64 = 8;

/// 证书与私钥在 app_data_dir 下的目录名
const TLS_DIR: &str = "tls";
const CERT_FILE: &str = "device.der";
const KEY_FILE: &str = "device.key.der";

/// 握手里出示的服务器名
///
/// 我们按证书指纹判定身份，这个名字不参与信任决策；但 rustls 要求提供一个合法的
/// DNS 名，所以给一个固定值。
const SERVER_NAME: &str = "easy2send.local";

/// 服务端侧的加密流
pub type ServerTlsStream = tokio_rustls::server::TlsStream<TcpStream>;
/// 客户端侧的加密流
pub type ClientTlsStream = tokio_rustls::client::TlsStream<TcpStream>;

/// 取 ring 的加密后端（缓存一份，避免每次握手都重建）
fn provider() -> &'static CryptoProvider {
    static PROVIDER: OnceLock<CryptoProvider> = OnceLock::new();
    PROVIDER.get_or_init(rustls::crypto::ring::default_provider)
}

/// 计算证书指纹：SHA-256(证书 DER)，小写十六进制
pub fn fingerprint_of(cert_der: &CertificateDer<'_>) -> String {
    let digest = Sha256::digest(cert_der.as_ref());
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 指纹太长，日志里只留前 12 位
fn short(fingerprint: &str) -> String {
    fingerprint.chars().take(12).collect()
}

// ---------- 本机身份 ----------

/// 本机设备身份：一对长期密钥 + 一张自签证书
///
/// 首次启动生成并落盘，之后一直复用——指纹一旦变化，所有对端都要重新确认一次。
pub struct DeviceIdentity {
    cert_der: CertificateDer<'static>,
    key_der: PrivateKeyDer<'static>,
    /// SHA-256(证书 DER)。这就是本机对外的身份凭据。
    fingerprint: String,
}

impl DeviceIdentity {
    /// 从 `dir` 读取身份；不存在或读不出来就生成一份并写入
    ///
    /// 读失败（文件损坏）时选择重新生成而不是报错：换一对新密钥的代价是对端要重新
    /// 确认一次，而带着一份坏身份启动则会让所有连接都失败且难以排查。
    pub fn load_or_create(dir: &Path) -> Result<Self> {
        let cert_path = dir.join(CERT_FILE);
        let key_path = dir.join(KEY_FILE);

        if let (Ok(cert_bytes), Ok(key_bytes)) =
            (std::fs::read(&cert_path), std::fs::read(&key_path))
        {
            if !cert_bytes.is_empty() && !key_bytes.is_empty() {
                let cert_der = CertificateDer::from(cert_bytes);
                let fingerprint = fingerprint_of(&cert_der);
                return Ok(Self {
                    cert_der,
                    key_der: PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_bytes)),
                    fingerprint,
                });
            }
        }

        let identity = Self::generate()?;
        std::fs::create_dir_all(dir)
            .with_context(|| format!("创建证书目录失败: {}", dir.display()))?;
        std::fs::write(&cert_path, identity.cert_der.as_ref()).context("写入证书失败")?;
        std::fs::write(&key_path, identity.key_der.secret_der()).context("写入私钥失败")?;
        println!(
            "[tls] 已生成本机身份证书，指纹 {}",
            short(&identity.fingerprint)
        );
        Ok(identity)
    }

    /// 本机在 app_data_dir 下的默认存放位置
    pub fn default_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
        use tauri::Manager;
        app.path()
            .app_data_dir()
            .map(|dir| dir.join(TLS_DIR))
            .unwrap_or_else(|_| std::path::PathBuf::from(TLS_DIR))
    }

    fn generate() -> Result<Self> {
        let key_pair =
            KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).context("生成本机密钥对失败")?;
        let mut params =
            CertificateParams::new(vec!["easy2send".to_string()]).context("构造证书参数失败")?;
        // 固定窗口而不是「当前时间 ± N 年」：证书内容因此与系统时钟无关，
        // 时钟不同步的设备之间也不会因为 not_before 还没到而握手失败。
        params.not_before = date_time_ymd(2020, 1, 1);
        params.not_after = date_time_ymd(2120, 1, 1);
        let cert = params
            .self_signed(&key_pair)
            .context("签发本机自签证书失败")?;

        let cert_der = cert.der().clone();
        let fingerprint = fingerprint_of(&cert_der);
        Ok(Self {
            cert_der,
            key_der: PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_pair.serialize_der())),
            fingerprint,
        })
    }

    /// 本机证书指纹（十六进制）
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    /// 服务端 TLS 配置：出示本机证书，接受任意客户端证书（准入在应用层判）
    pub fn server_config(&self) -> Result<Arc<ServerConfig>> {
        let config = ServerConfig::builder()
            .with_client_cert_verifier(Arc::new(AcceptAnyClientCert))
            .with_single_cert(
                vec![self.cert_der.clone()],
                self.key_der.clone_key(),
            )
            .context("构建 TLS 服务端配置失败")?;
        Ok(Arc::new(config))
    }

    /// 客户端 TLS 配置：出示本机证书，并按 `expected` 固定对端证书
    pub fn client_config(&self, expected_fingerprint: Option<String>) -> Result<Arc<ClientConfig>> {
        let config = ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(PinnedServerCert {
                expected: expected_fingerprint,
            }))
            .with_client_auth_cert(vec![self.cert_der.clone()], self.key_der.clone_key())
            .context("构建 TLS 客户端配置失败")?;
        Ok(Arc::new(config))
    }
}

// ---------- 证书验证器 ----------

/// 服务端侧：接受任意客户端证书，但仍验证「对端确实持有该证书的私钥」
///
/// 自签证书没有信任锚，链式校验在此无意义。但签名验证不能省——它证明对端持有私钥，
/// 而不是从 mDNS 上抄了个公钥过来。是否信任这台设备由应用层拿指纹查表决定。
#[derive(Debug)]
struct AcceptAnyClientCert;

impl ClientCertVerifier for AcceptAnyClientCert {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    /// 强制客户端出示证书：没有证书就没有指纹，也就没有可校验的身份。
    fn client_auth_mandatory(&self) -> bool {
        true
    }

    fn verify_client_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _now: UnixTime,
    ) -> std::result::Result<ClientCertVerified, TlsError> {
        Ok(ClientCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &provider().signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &provider().signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// 客户端侧：按信任表里记录的指纹固定对端证书
///
/// `expected = None` 表示首次接触（信任表里还没有这台设备），此时放行、交给上层做
/// TOFU 确认；`Some(fp)` 则要求完全一致。
///
/// 这是**防中间人**的关键一环：攻击者即便能劫持流量，也拿不出与已记录指纹相同的
/// 证书——那需要对方的私钥。少了这一条，服务端虽然能靠客户端证书挡住冒充者，
/// 但客户端仍会把文件发给了冒充成对端的中间人。
#[derive(Debug)]
struct PinnedServerCert {
    expected: Option<String>,
}

impl ServerCertVerifier for PinnedServerCert {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, TlsError> {
        let actual = fingerprint_of(end_entity);
        match &self.expected {
            Some(expected) if expected == &actual => Ok(ServerCertVerified::assertion()),
            Some(expected) => Err(TlsError::General(format!(
                "对端证书指纹与记录不符（记录 {}…，实际 {}…），可能存在中间人",
                short(expected),
                short(&actual)
            ))),
            None => Ok(ServerCertVerified::assertion()),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &provider().signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &provider().signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

// ---------- 建连 ----------

/// 在一条已建立的 TCP 连接上完成服务端 TLS 握手
pub async fn accept(tcp: TcpStream, config: Arc<ServerConfig>) -> Result<ServerTlsStream> {
    tokio::time::timeout(
        Duration::from_secs(TLS_HANDSHAKE_TIMEOUT_SECS),
        TlsAcceptor::from(config).accept(tcp),
    )
    .await
    .map_err(|_| anyhow!("TLS 握手超时({}s)", TLS_HANDSHAKE_TIMEOUT_SECS))?
    .map_err(|e| anyhow!("TLS 握手失败: {}", e))
}

/// 建立一条到对端的加密连接
///
/// `expected_fingerprint` 来自本机信任表（`TrustState::fingerprint_of`）：
/// 有值则要求对端证书指纹完全匹配，为 `None` 时按首次接触处理。
pub async fn connect(
    addr: &str,
    identity: &DeviceIdentity,
    expected_fingerprint: Option<String>,
) -> Result<ClientTlsStream> {
    let tcp = tokio::time::timeout(
        Duration::from_secs(CONNECT_TIMEOUT_SECS),
        TcpStream::connect(addr),
    )
    .await
    .map_err(|_| anyhow!("连接超时({}s): {}", CONNECT_TIMEOUT_SECS, addr))??;
    tcp.set_nodelay(true)?;
    crate::transfer::protocol::tune_socket_buffers(&tcp);

    let connector = TlsConnector::from(identity.client_config(expected_fingerprint)?);
    let server_name =
        ServerName::try_from(SERVER_NAME).map_err(|e| anyhow!("非法服务器名: {}", e))?;
    tokio::time::timeout(
        Duration::from_secs(TLS_HANDSHAKE_TIMEOUT_SECS),
        connector.connect(server_name, tcp),
    )
    .await
    .map_err(|_| anyhow!("TLS 握手超时({}s): {}", TLS_HANDSHAKE_TIMEOUT_SECS, addr))?
    .map_err(|e| anyhow!("TLS 握手失败 {}: {}", addr, e))
}

/// 取对端出示的证书指纹（服务端侧）
pub fn peer_fingerprint_server(stream: &ServerTlsStream) -> Option<String> {
    first_cert_fingerprint(stream.get_ref().1.peer_certificates())
}

/// 取对端出示的证书指纹（客户端侧）
pub fn peer_fingerprint_client(stream: &ClientTlsStream) -> Option<String> {
    first_cert_fingerprint(stream.get_ref().1.peer_certificates())
}

fn first_cert_fingerprint(certs: Option<&[CertificateDer<'static>]>) -> Option<String> {
    certs.and_then(|list| list.first()).map(fingerprint_of)
}

// ---------- 测试 ----------
//
// 这里测的是「加密与身份校验真的生效」，不是「代码能编译」。三件事：
//   1. 两条真实 TCP 连接能完成 TLS 握手，并各自取到对方的证书指纹
//   2. 期望指纹与实际不符时必须拒绝（中间人场景）
//   3. 明文客户端必须被拒（旧版协议 / 裸 socket 探测）
#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// 在临时目录里造一个身份（每个用例用独立目录，避免相互干扰）
    fn temp_identity(tag: &str) -> DeviceIdentity {
        let dir = std::env::temp_dir().join(format!("e2s-tls-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        DeviceIdentity::load_or_create(&dir).expect("生成测试身份失败")
    }

    /// 身份必须落盘且可复用：指纹一旦变化，所有对端都要重新确认一次
    #[test]
    fn identity_persists_across_loads() {
        let dir = std::env::temp_dir().join(format!("e2s-tls-persist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let first = DeviceIdentity::load_or_create(&dir).expect("首次生成失败");
        let fingerprint = first.fingerprint().to_string();

        // SHA-256 → 64 个十六进制字符
        assert_eq!(fingerprint.len(), 64, "指纹应为 SHA-256 十六进制");
        assert!(
            fingerprint.chars().all(|c| c.is_ascii_hexdigit()),
            "指纹只能含十六进制字符"
        );

        let second = DeviceIdentity::load_or_create(&dir).expect("二次加载失败");
        assert_eq!(
            second.fingerprint(),
            fingerprint,
            "二次加载必须复用同一份身份"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 完整握手：双方各取到对方指纹，且通道可双向传数据
    #[tokio::test]
    async fn encrypted_channel_exchanges_data_and_fingerprints() {
        let server_id = temp_identity("srv-ok");
        let client_id = temp_identity("cli-ok");
        let server_fp = server_id.fingerprint().to_string();
        let client_fp = client_id.fingerprint().to_string();
        let cfg = server_id.server_config().expect("服务端配置失败");

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("监听失败");
        let addr = listener.local_addr().unwrap().to_string();

        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.expect("accept 失败");
            let mut stream = accept(tcp, cfg).await.expect("服务端 TLS 握手失败");
            let seen = peer_fingerprint_server(&stream).expect("服务端未取到客户端指纹");
            stream.write_all(b"pong").await.expect("写失败");
            stream.flush().await.expect("flush 失败");
            seen
        });

        // 首次接触：不固定对端指纹（信任表里还没有它）
        let mut client = connect(&addr, &client_id, None)
            .await
            .expect("客户端 TLS 握手失败");

        assert_eq!(
            peer_fingerprint_client(&client).as_deref(),
            Some(server_fp.as_str()),
            "客户端取到的应是服务端证书指纹"
        );

        let mut buf = [0u8; 4];
        client.read_exact(&mut buf).await.expect("读失败");
        assert_eq!(&buf, b"pong", "加密通道应能双向传数据");

        assert_eq!(
            server.await.expect("服务端任务 panic"),
            client_fp,
            "服务端取到的应是客户端证书指纹"
        );
    }

    /// 对端证书与记录不符 ⇒ 拒绝连接（这正是中间人攻击的样子）
    #[tokio::test]
    async fn pinned_fingerprint_mismatch_is_rejected() {
        let server_id = temp_identity("srv-pin");
        let client_id = temp_identity("cli-pin");
        let attacker_id = temp_identity("third-party");
        let cfg = server_id.server_config().expect("服务端配置失败");

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("监听失败");
        let addr = listener.local_addr().unwrap().to_string();

        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.expect("accept 失败");
            // 客户端会主动中止，服务端这边同样拿不到可用连接
            accept(tcp, cfg).await.is_err()
        });

        // 拿着第三方的指纹去连：证书对不上，必须拒绝
        let wrong = attacker_id.fingerprint().to_string();
        let result = connect(&addr, &client_id, Some(wrong)).await;
        assert!(result.is_err(), "指纹不匹配时必须拒绝连接");

        let _ = server.await;
    }

    /// 明文客户端（旧版协议、或裸 socket 探测）必须被 TLS 层拒之门外
    #[tokio::test]
    async fn plaintext_client_is_rejected() {
        let server_id = temp_identity("srv-plain");
        let cfg = server_id.server_config().expect("服务端配置失败");

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("监听失败");
        let addr = listener.local_addr().unwrap().to_string();

        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.expect("accept 失败");
            accept(tcp, cfg).await.is_err()
        });

        // 直接按旧协议发明文：mode=7 + 长度前缀 + device_id
        let mut raw = TcpStream::connect(&addr).await.expect("明文连接失败");
        let _ = raw.write_all(&[7u8, 0, 0, 0, 1, b'x']).await;
        let _ = raw.flush().await;
        drop(raw);

        assert!(
            server.await.expect("服务端任务 panic"),
            "明文连接不应通过 TLS 层"
        );
    }
}
