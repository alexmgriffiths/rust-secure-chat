mod commands;
mod db;
mod handlers;
mod protocol;
mod redis_helper;
mod router;
mod send;
mod state;

use protocol::Event;
use router::{handle_connection, handle_router};
use std::env;
use tokio::{
    net::TcpListener,
    sync::mpsc::{self, UnboundedSender},
};

use crate::{db::connect, protocol::PubSubPayload};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL not set");
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL not set");
    let server_id = env::var("SERVER_ID").expect("SERVER_ID not set");

    let pool = connect(&database_url).await;
    if let Err(e) = sqlx::migrate!("./migrations").run(&pool).await {
        eprintln!("Failed to run migrations: {e}");
        return;
    };

    let redis = match redis_helper::RedisHelper::connect(&redis_url).await {
        Err(e) => {
            eprintln!("Failed to connected to Redis: {e}");
            return;
        }
        Ok(r) => r,
    };

    let (tx, rx) = mpsc::unbounded_channel::<Event>(); // Don't set a fixed size of messages
    // In the future we should really use a bounded channel and handle back pressure... :/

    let listener = TcpListener::bind("127.0.0.1:9901")
        .await
        .expect("failed to bind socket");
    println!("Listening on 127.0.0.1:9901");

    tokio::spawn(handle_redis_setup(tx.clone()));
    tokio::spawn(handle_router(rx, pool, redis, server_id));

    let mut next_id: u64 = 0;

    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(handle_connection(tx.clone(), stream, next_id));
        next_id += 1;
    }
}

// TODO: Move to another file
pub fn handle_redis_subscriber(redis_url: String, server_id: String, tx: UnboundedSender<String>) {
    // connect to Redis, subscribe, push raw payloads through tx
    let client = redis::Client::open(redis_url).expect("Failed to open connection to Redis");
    let mut con = client
        .get_connection()
        .expect("Failed to use open connection to redis");
    let mut pubsub = con.as_pubsub();
    if pubsub.subscribe(server_id.clone()).is_err() {
        eprintln!("Failed to subscribe to channel {server_id}");
        return;
    };

    loop {
        let msg = match pubsub.get_message() {
            Err(_) => continue,
            Ok(m) => m,
        };
        let payload: String = match msg.get_payload() {
            Err(_) => continue,
            Ok(p) => p,
        };
        if tx.send(payload).is_err() {
            eprintln!("Failed to send payload to channel");
            continue;
        };
    }
}

pub async fn handle_redis_setup(main_sender: UnboundedSender<Event>) {
    let redis_url = env::var("REDIS_URL").expect("REDIS_URL not set");
    let server_id = env::var("SERVER_ID").expect("SERVER_ID not set");
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    tokio::task::spawn_blocking(move || handle_redis_subscriber(redis_url, server_id, tx));
    while let Some(raw) = rx.recv().await {
        // parse raw JSON into Event::PubSubDelivery fields, send to router
        let Ok(msg) = serde_json::from_str::<PubSubPayload>(&raw) else {
            eprintln!("Malformed payload from Redis: {raw}");
            continue;
        };
        if main_sender
            .send(Event::PubSubDelivery {
                mailbox_id: msg.mailbox_id,
                payload: msg.payload,
                message_id: msg.message_id,
                seq: msg.seq,
            })
            .is_err()
        {
            // TODO: Tracing
            eprintln!("Failed to send PubSubDelivery event");
            continue;
        };
    }
}
