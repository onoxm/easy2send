// use std::{thread, time};
// use tauri::{command, Window};

// #[derive(Clone, serde:: Serialize)]
// struct Payload {
//     message: String,
// }

// impl Payload {
//     fn new(message: String) -> Self {
//         Self { message }
//     }
// }

// #[command]
// pub fn transfer_data(window: Window, event_name: String, message: String) {
//     let mut time = 0;
//     std::thread::spawn(move || loop {
//         window
//             .emit(event_name.as_str(), Payload::new(message.clone().into()))
//             .unwrap();

//         thread::sleep(time::Duration::from_millis(500));
//         time = time + 1;

//         if time == 2 {
//             break; // 通过 break 语句停止循环
//         };
//     });
// }
