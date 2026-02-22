use std::collections::HashMap;

use jsonwebtoken::DecodingKey;
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

use crate::{
    db::DbPool,
    protocol::ServerMsg,
    redis_helper::RedisHelper,
    send::{SendServerMsgError, send_server_msg},
};

pub struct RouterState {
    pub decoding_key: DecodingKey,
    pub connections: HashMap<u64, UnboundedSender<Message>>,
    pub connection_to_mailbox: HashMap<u64, Uuid>, // Given a connection, which mailbox does it own?
    pub mailbox_to_connections: HashMap<Uuid, Vec<u64>>, // Given a mailbox, which connections are active for it?

    pub db: DbPool,
    pub redis: RedisHelper,
    pub server_id: String,
}

impl RouterState {
    pub fn new(
        decoding_key: DecodingKey,
        db: DbPool,
        redis: RedisHelper,
        server_id: String,
    ) -> RouterState {
        RouterState {
            decoding_key,
            connections: HashMap::new(),
            connection_to_mailbox: HashMap::new(),
            mailbox_to_connections: HashMap::new(),
            db,
            redis,
            server_id,
        }
    }

    pub fn disconnect_client(&mut self, client_id: u64) {
        self.connections.remove(&client_id);

        if let Some(mailbox_id) = self.connection_to_mailbox.remove(&client_id) {
            if let Some(conns) = self.mailbox_to_connections.get_mut(&mailbox_id) {
                conns.retain(|&id| id != client_id);
                if conns.is_empty() {
                    self.mailbox_to_connections.remove(&mailbox_id);
                }
            }
        }
    }

    pub fn send_or_disconnect_server_msg(
        &mut self,
        client_id: u64,
        tx: &UnboundedSender<Message>,
        msg: &ServerMsg,
    ) {
        if let Err(e) = send_server_msg(tx, msg) {
            match e {
                SendServerMsgError::ClientError => self.disconnect_client(client_id),
                SendServerMsgError::SerializationError { error } => {
                    eprintln!("Serialization error: {error}")
                }
            }
        }
    }

    pub fn deliver_to_mailbox(&mut self, mailbox_id: Uuid, payload: &str) {
        let message = ServerMsg::Delivery {
            payload: payload.to_string(),
        };

        let connections = match self.mailbox_to_connections.get(&mailbox_id) {
            Some(c) => c,
            None => {
                eprintln!("Tried to deliver message to no active clients NO_CONNECTIONS");
                return;
            }
        };
        let clients_to_send_to: Vec<u64> = connections.iter().copied().collect();
        let mut mailboxes_to_send_to: Vec<(u64, UnboundedSender<Message>)> = vec![];
        for c in clients_to_send_to {
            let connection = match self.connections.get(&c) {
                Some(conn) => conn.clone(),
                None => continue,
            };
            mailboxes_to_send_to.push((c, connection));
        }

        for (client_id, mailbox) in mailboxes_to_send_to {
            self.send_or_disconnect_server_msg(client_id, &mailbox, &message);
        }
    }
}
