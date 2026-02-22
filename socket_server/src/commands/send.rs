use std::collections::HashSet;

use uuid::Uuid;

use crate::{protocol::PubSubPayload, state::RouterState};

pub enum SendError {
    RedisPayloadSerializeFailed,
}

pub async fn handle_send_command(
    router_state: &mut RouterState,
    payload: &str,
    mailbox_id: Uuid,
    message_id: Uuid,
    sender_client_id: u64,
) -> Result<(), SendError> {
    // Things to do
    // Insert into pending_messages
    let seq = sqlx::query_scalar(
        r#"
    INSERT INTO pending_messages (id, mailbox_id, payload, created_at)
    VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO NOTHING RETURNING seq
    "#,
    )
    .bind(message_id)
    .bind(mailbox_id)
    .bind(payload)
    .fetch_one(&router_state.db)
    .await
    .unwrap_or(0);

    // Send ServerMsg::Ack back to sender
    // We send ACKS back to say "Hey this message has persisted in the database, go ahead and commit to updating your ratchet state"
    let client_sender = router_state.connections.get(&sender_client_id).cloned();

    if let Some(client_sender) = client_sender {
        router_state.send_or_disconnect_server_msg(
            sender_client_id,
            &client_sender,
            &crate::protocol::ServerMsg::Ack {
                message_id: message_id.to_string(),
            },
        );
    }

    // Create the payload, we might need it later and don't want to make it in the loop
    let pubsub_payload = match serde_json::to_string(&PubSubPayload {
        mailbox_id,
        message_id,
        seq,
        payload: payload.to_string(),
    }) {
        Err(e) => {
            eprintln!("Error creating pubsub payload: {e}");
            return Err(SendError::RedisPayloadSerializeFailed);
        }
        Ok(p) => p,
    };

    // HGETALL if the map is empty, recipient is offline, return early
    // For each unique server in the map, if it matches router_state.server_id call deliver to mailbox
    // Then mark delivered at. This allows us to cheat some of the routing cauise we're on tyhe same socket
    // If it's on a different server call router_state.redis.publish(server_id, json_payload)
    let recipient_connections = router_state.redis.get_connections(mailbox_id).await;
    let servers: HashSet<String> = recipient_connections.into_values().collect();
    for rconn_server in servers {
        if rconn_server == router_state.server_id {
            router_state.deliver_to_mailbox(mailbox_id, seq, payload);
        } else {
            // Some other server's problem
            router_state
                .redis
                .publish(&rconn_server, &pubsub_payload)
                .await;
        }
    }
    Ok(())
}
