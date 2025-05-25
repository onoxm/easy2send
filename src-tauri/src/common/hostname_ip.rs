use std::{env::consts, net::Ipv4Addr, process::Command, str::FromStr};

pub fn get_lan_ip() -> Ipv4Addr {
    match consts::OS {
        "windows" => {
            let output = get_output_in("ipconfig");
            let (output, _, _) = encoding_rs::GBK.decode(&output);
            get_windows_lan_ip(output.to_string())
        }
        _ => panic!("This os does not support!"),
    }
}

fn get_output_in(name: &str) -> Vec<u8> {
    Command::new(name).output().expect("command error!").stdout
}

fn get_windows_lan_ip(output: String) -> Ipv4Addr {
    output
        .lines()
        .map(|l| l.trim_end())
        .filter_map(|l| {
            if l.contains("IPv4 地址") {
                l.find(": ").map(|i| &l[i + 2..])
            } else if l.contains("IPv4 Address") {
                l.find(": ").map(|i| &l[i + 2..])
            } else {
                None
            }
        })
        .filter_map(|l| Ipv4Addr::from_str(l).ok())
        .next()
        .expect("lan ip resolution failed!")
}
