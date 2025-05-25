use std::net::TcpListener;

fn is_port_in_use(ip: &str, port: u16) -> bool {
    // 尝试在指定端口上绑定一个 TCP 监听器
    TcpListener::bind((ip, port)).is_err()
}

pub fn get_unused_port(ip: &str, port: u16) -> u16 {
    if is_port_in_use(ip, port) {
        loop {
            if !is_port_in_use(ip, port + 1) {
                break port + 1;
            };
        }
    } else {
        port
    }
}