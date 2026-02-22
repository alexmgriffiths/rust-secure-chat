use std::env;

use crate::{
    db::DbPool,
    handlers::{
        connected::handle_connected_event, disconnected::handle_disconnected_event,
        pubsub::handle_pubsub_delivery_event, received::handle_received_event,
    },
    protocol::Event,
    redis_helper::RedisHelper,
    state::RouterState,
};

use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use jsonwebtoken::DecodingKey;
use tokio::{
    net::TcpStream,
    sync::mpsc::{self, UnboundedReceiver, UnboundedSender},
};
use tokio_tungstenite::{WebSocketStream, tungstenite::Message};

pub async fn handle_router(
    mut received: UnboundedReceiver<Event>,
    db: DbPool,
    redis: RedisHelper,
    server_id: String,
) {
    let decoding_key =
        DecodingKey::from_secret(env::var("JWT_SECRET").expect("no JWT_SECRET set").as_ref());
    let mut router_state: RouterState = RouterState::new(decoding_key, db, redis, server_id);

    while let Some(ev) = received.recv().await {
        match ev {
            Event::Connected { client_id, out_tx } => {
                handle_connected_event(&mut router_state, client_id, out_tx);
            }
            Event::Received { client_id, command } => {
                handle_received_event(&mut router_state, client_id, command).await;
            }
            Event::Disconnected { client_id } => {
                handle_disconnected_event(&mut router_state, client_id).await;
            }

            Event::PubSubDelivery {
                mailbox_id,
                payload,
                message_id,
                seq,
            } => {
                handle_pubsub_delivery_event(
                    &mut router_state,
                    mailbox_id,
                    seq,
                    payload,
                    message_id,
                )
                .await;
            }
        }
    }
}

pub async fn handle_connection(tx: UnboundedSender<Event>, stream: TcpStream, client_id: u64) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("client {client_id}: websocket handshake failed: {e}");
            return;
        }
    };
    let (out_tx, out_rx) = mpsc::unbounded_channel::<Message>();

    // Tell the main router thread that this user is connected
    if let Err(e) = tx.send(Event::Connected { client_id, out_tx }) {
        eprintln!("error on tx send: {e}");
        return;
    }

    let (writer, mut reader) = ws_stream.split();

    // Handle writer thread
    tokio::spawn(handle_client_writer(writer, out_rx));

    // Handle reader
    while let Some(item) = reader.next().await {
        match item {
            Ok(Message::Text(t)) => {
                // Just forward commands to the router
                match serde_json::from_str(&t) {
                    Ok(value) => {
                        if let Err(e) = tx.send(Event::Received {
                            client_id,
                            command: value,
                        }) {
                            eprintln!("failed to send command: {e}");
                            continue;
                        }
                    }
                    Err(e) => {
                        eprintln!("could not parse json: {e}");
                        continue;
                    }
                }
            }
            Ok(Message::Close(_)) => {
                break;
            }
            Err(_) => {
                break;
            }
            _ => {}
        }
    }

    // If we broke out of the reader, it's because the client disconnected... probably.
    if let Err(e) = tx.send(Event::Disconnected { client_id }) {
        eprintln!("failed to send disconnect event: {e}");
    }
}

async fn handle_client_writer(
    mut writer: SplitSink<WebSocketStream<TcpStream>, Message>,
    mut out_rx: UnboundedReceiver<Message>,
) {
    while let Some(msg) = out_rx.recv().await {
        // So the router passes out_rx down to handle_connection, which creates this task and passes out_rx again
        // So writer is the writer for the TcpStream, and since we have the out_rx from the original receiver we can catch
        // messages from the router and pipe them to the stream's writer
        if let Err(e) = writer.send(msg).await {
            eprintln!("failed to send message to writer: {e}");
            break;
        }
    }
}
