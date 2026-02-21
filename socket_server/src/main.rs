mod commands;
mod handlers;
mod protocol;
mod router;
mod send;
mod state;

use protocol::Event;
use router::{handle_connection, handle_router};
use std::io::Error;
use tokio::{
    net::TcpListener,
    sync::mpsc::{self},
};

#[tokio::main]
async fn main() -> Result<(), Error> {
    dotenvy::dotenv().ok();

    let (tx, rx) = mpsc::unbounded_channel::<Event>(); // Don't set a fixed size of messages
    // In the future we should really use a bounded channel and handle back pressure... :/

    let listener = TcpListener::bind("127.0.0.1:9901")
        .await
        .expect("failed to bind socket");
    println!("Listening on 127.0.0.1:9901");

    tokio::spawn(handle_router(rx));

    let mut next_id: u64 = 0;

    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(handle_connection(tx.clone(), stream, next_id));
        next_id += 1;
    }

    Ok(())
}
