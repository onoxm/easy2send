//! 传输层性能 benchmark
//!
//! 本地模拟两台设备传输大文件，实测优化后的吞吐速率。
//! 复用生产代码的全部优化参数：4MB chunk、socket 缓冲区调优、流式协议、BufWriter。
//!
//! 用法：
//!   cargo run --example bench_transfer [大小MB，默认1024]
//!   cargo run --example bench_transfer 2048   # 2GB

use std::time::{Duration, Instant};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufWriter};
use tokio::net::{TcpListener, TcpStream};

/// 与生产代码 protocol.rs 保持一致的优化参数
const CHUNK_SIZE: usize = 4 * 1024 * 1024;
const SOCKET_BUF_SIZE: usize = 4 * 1024 * 1024;

/// 调大 socket 收发缓冲区（与生产代码 tune_socket_buffers 一致）
fn tune_socket_buffers(stream: &TcpStream) {
    let sock = socket2::SockRef::from(stream);
    let _ = sock.set_recv_buffer_size(SOCKET_BUF_SIZE);
    let _ = sock.set_send_buffer_size(SOCKET_BUF_SIZE);
}

/// 生成指定大小的测试文件（填充可验证的伪随机模式）
async fn generate_test_file(path: &str, size: u64) -> std::io::Result<()> {
    let mut file = File::create(path).await?;
    // 用递增字节模式填充，便于后续验证完整性
    let mut chunk = vec![0u8; CHUNK_SIZE];
    let mut byte_val: u8 = 0;
    let mut written = 0u64;

    while written < size {
        let n = std::cmp::min(CHUNK_SIZE as u64, size - written) as usize;
        for b in &mut chunk[..n] {
            *b = byte_val;
            byte_val = byte_val.wrapping_add(1);
        }
        file.write_all(&chunk[..n]).await?;
        written += n as u64;
    }
    file.flush().await?;
    Ok(())
}

/// 验证两个文件内容完全一致
async fn verify_files(path_a: &str, path_b: &str) -> std::io::Result<bool> {
    let meta_a = tokio::fs::metadata(path_a).await?;
    let meta_b = tokio::fs::metadata(path_b).await?;
    if meta_a.len() != meta_b.len() {
        return Ok(false);
    }

    let mut file_a = File::open(path_a).await?;
    let mut file_b = File::open(path_b).await?;
    let mut buf_a = vec![0u8; CHUNK_SIZE];
    let mut buf_b = vec![0u8; CHUNK_SIZE];

    loop {
        let n_a = file_a.read(&mut buf_a).await?;
        let n_b = file_b.read(&mut buf_b).await?;
        if n_a != n_b {
            return Ok(false);
        }
        if n_a == 0 {
            break;
        }
        if buf_a[..n_a] != buf_b[..n_b] {
            return Ok(false);
        }
    }
    Ok(true)
}

// ============ 接收端（与 server.rs 逻辑一致） ============

async fn run_server(listener: TcpListener, save_path: &str) -> std::io::Result<u64> {
    let (mut stream, peer) = listener.accept().await?;
    let _ = stream.set_nodelay(true);
    tune_socket_buffers(&stream);

    // 读取元数据：文件名长度(4B) + 文件名 + 文件大小(8B)
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let name_len = u32::from_be_bytes(len_buf) as usize;
    let mut name_buf = vec![0u8; name_len];
    stream.read_exact(&mut name_buf).await?;
    let filename = String::from_utf8_lossy(&name_buf).to_string();

    let mut size_buf = [0u8; 8];
    stream.read_exact(&mut size_buf).await?;
    let total_size = u64::from_be_bytes(size_buf);

    let mut file = File::create(save_path).await?;
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut received = 0u64;
    let start = Instant::now();
    let mut last_print = Instant::now();

    // 流式协议：按 remaining.min(CHUNK_SIZE) 读取
    while received < total_size {
        let to_read = ((total_size - received).min(CHUNK_SIZE as u64)) as usize;
        stream.read_exact(&mut buffer[..to_read]).await?;
        file.write_all(&buffer[..to_read]).await?;
        received += to_read as u64;

        // 每 500ms 打印一次进度
        if last_print.elapsed() >= Duration::from_millis(500) {
            let progress = (received as f64 / total_size as f64) * 100.0;
            let elapsed = start.elapsed().as_secs_f64();
            let speed = (received as f64 / 1024.0 / 1024.0) / elapsed;
            print!(
                "\r[接收] {:.1}% | {:.2} MB/s | {}/{} MB",
                progress,
                speed,
                received / 1024 / 1024,
                total_size / 1024 / 1024
            );
            // 刷新 stdout 确保进度显示
            use std::io::Write;
            std::io::stdout().flush().ok();
            last_print = Instant::now();
        }
    }
    file.flush().await?;
    println!();
    println!("[server] 从 {} 接收完成: {} ({} bytes)", peer, filename, received);
    Ok(received)
}

// ============ 发送端（与 client.rs 逻辑一致） ============

async fn run_client(addr: &str, file_path: &str) -> std::io::Result<u64> {
    let mut file = File::open(file_path).await?;
    let file_size = file.metadata().await?.len();
    let filename = std::path::Path::new(file_path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();

    let stream = TcpStream::connect(addr).await?;
    stream.set_nodelay(true)?;
    tune_socket_buffers(&stream);
    let mut stream = BufWriter::new(stream);

    // 发送元数据：文件名长度(4B) + 文件名 + 文件大小(8B)
    let name_len = filename.len() as u32;
    stream.write_all(&name_len.to_be_bytes()).await?;
    stream.write_all(filename.as_bytes()).await?;
    stream.write_all(&file_size.to_be_bytes()).await?;

    // 流式传输文件内容（无 chunk_len 前缀）
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut sent = 0u64;

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        stream.write_all(&buffer[..n]).await?;
        sent += n as u64;
    }
    stream.flush().await?;
    println!("[client] 发送完成: {} bytes", sent);
    Ok(sent)
}

#[tokio::main]
async fn main() {
    let size_mb: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(1024);
    let size_bytes = size_mb * 1024 * 1024;

    let send_path = format!("bench_send_{}mb.tmp", size_mb);
    let recv_path = format!("bench_recv_{}mb.tmp", size_mb);
    let addr = "127.0.0.1:18923";

    println!("========================================");
    println!(" Easy2Send 传输性能 Benchmark");
    println!("========================================");
    println!("文件大小: {} MB", size_mb);
    println!("Chunk 大小: {} MB", CHUNK_SIZE / 1024 / 1024);
    println!("Socket 缓冲区: {} MB", SOCKET_BUF_SIZE / 1024 / 1024);
    println!("协议: 流式（无 chunk_len 前缀）");
    println!("地址: {}", addr);
    println!("----------------------------------------");

    // 1. 生成测试文件
    print!("[1/4] 生成测试文件... ");
    let t0 = Instant::now();
    generate_test_file(&send_path, size_bytes)
        .await
        .expect("生成测试文件失败");
    println!("耗时 {:.2}s", t0.elapsed().as_secs_f64());

    // 2. 启动 server + client 传输
    println!("[2/4] 开始传输...");
    let listener = TcpListener::bind(addr)
        .await
        .expect("绑定端口失败");

    let recv_path_clone = recv_path.clone();
    let server_task = tokio::spawn(async move {
        run_server(listener, &recv_path_clone).await
    });

    // 等 server 就绪
    tokio::time::sleep(Duration::from_millis(100)).await;

    let t_transfer = Instant::now();
    let sent = run_client(addr, &send_path)
        .await
        .expect("发送失败");
    let received = server_task
        .await
        .expect("server task panic")
        .expect("server 传输失败");
    let transfer_elapsed = t_transfer.elapsed();

    // 3. 输出吞吐结果
    let throughput_mbs = (size_mb as f64) / transfer_elapsed.as_secs_f64();
    let throughput_mbps = throughput_mbs * 8.0;

    println!();
    println!("[3/4] 传输结果");
    println!("----------------------------------------");
    println!("发送: {} bytes", sent);
    println!("接收: {} bytes", received);
    println!("传输耗时: {:.3} s", transfer_elapsed.as_secs_f64());
    println!("吞吐速率: {:.2} MB/s", throughput_mbs);
    println!("带宽占用: {:.2} Mbps", throughput_mbps);
    println!("----------------------------------------");

    // 4. 验证文件完整性
    print!("[4/4] 验证文件完整性... ");
    let ok = verify_files(&send_path, &recv_path)
        .await
        .expect("验证失败");
    if ok {
        println!("✅ 通过");
    } else {
        println!("❌ 失败（文件内容不一致）");
    }

    // 清理临时文件
    tokio::fs::remove_file(&send_path).await.ok();
    tokio::fs::remove_file(&recv_path).await.ok();

    println!();
    println!("提示: 如需测量 CPU 占用，请用 bench-transfer.ps1 脚本运行此 benchmark。");
}
