use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::prelude::FromRow;
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    Authenticate {
        token: String,
        #[serde(default)]
        last_seq: i64,
    },
    Send {
        mailbox_id: String,
        payload: String,
        message_id: String,
    },
    Typing {
        mailbox_id: String,
        payload: String,
    },
    StopTyping {
        mailbox_id: String,
        payload: String,
    },
}

#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Delivery { seq: i64, payload: String },
    Info { message: String },
    Error { message: String },
    Ack { message_id: String },
    Typing { payload: String },
    StopTyping { payload: String },
}

pub enum Event {
    Connected {
        client_id: u64,
        out_tx: UnboundedSender<Message>,
    },
    Received {
        client_id: u64,
        command: Command,
    },
    Disconnected {
        client_id: u64,
    },
    PubSubDelivery {
        mailbox_id: Uuid,
        payload: String,
        seq: i64,
        message_id: Uuid,
    },
}

// TODO: Move to models, or it's own folder idk yet
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub struct UserInfo {
    pub id: Uuid,
    pub username: String,

    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub updated_at: DateTime<Utc>,
}

// TODO: This too
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub struct Claims {
    pub sub: String,
    pub user: UserInfo,
    pub exp: usize,
    pub iat: usize,
}

// TODO: Probably could go in a redis folder or something who fucking know
#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub struct PubSubPayload {
    pub mailbox_id: Uuid,
    pub message_id: Uuid,
    pub seq: i64,
    pub payload: String,
}

#[derive(Serialize, Deserialize, FromRow)]
#[serde(tag = "type", rename_all = "snake_case")]
pub struct PendingMessage {
    pub id: Uuid,
    pub mailbox_id: Uuid,
    pub seq: i64,
    pub payload: String,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,

    // Not sure how to handle this since it's a nullable field
    #[serde(with = "chrono::serde::ts_seconds_option")]
    pub delivered_at: Option<DateTime<Utc>>,
}
