use std::{fs::File, io::Write};
use tauri::command;

#[command]
pub fn write_binary_file(path: String, buf: String) {
    let mut buffer = File::create(path).unwrap();
    buffer.write_all(buf.as_bytes()).unwrap();
    // println!("{:?}", buf.as_bytes());
}

#[command]
pub fn write_text_file(path: String, message: String) {
    let mut buffer = File::create(path).unwrap();
    buffer.write_all(message.as_bytes()).unwrap();
}
