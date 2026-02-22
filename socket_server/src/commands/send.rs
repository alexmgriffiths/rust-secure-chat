use uuid::Uuid;

use crate::{protocol::PubSubPayload, state::RouterState};

pub enum SendError {
    InsertionFailed,
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
    if let Err(e) = sqlx::query(
        r#"
    INSERT INTO pending_messages (id, mailbox_id, payload, created_at)
    VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO NOTHING
    "#,
    )
    .bind(message_id)
    .bind(mailbox_id)
    .bind(payload)
    .execute(&router_state.db)
    .await
    {
        eprintln!("Failed to insert message: {e}");
        return Err(SendError::InsertionFailed);
    }

    // Send ServerMsg::Ack back to sender
    // We send ACKS back to say "Hey this message has persisted in the database, go ahead and commit to updating your ratchet state"
    // There's also a smal bug in here that could crash.  thserver
    // If a client disconnects fast enough the server will shit itself
    // TODO: Fix panic
    let client_sender = router_state
        .connections
        .get(&sender_client_id)
        .unwrap()
        .clone(); // It's really unlikely this fails
    router_state.send_or_disconnect_server_msg(
        sender_client_id,
        &client_sender,
        &crate::protocol::ServerMsg::Ack {
            message_id: message_id.to_string(),
        },
    );

    // Create the payload, we might need it later and don't want to make it in the loop
    let pubsub_payload = match serde_json::to_string(&PubSubPayload {
        mailbox_id,
        message_id,
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
    for (_, rconn_server) in recipient_connections {
        if rconn_server == router_state.server_id {
            router_state.deliver_to_mailbox(mailbox_id, payload);
            if let Err(e) = sqlx::query(
                r#"
                UPDATE pending_messages SET delivered_at = NOW() WHERE id = $1
                "#,
            )
            .bind(message_id)
            .execute(&router_state.db)
            .await
            {
                // TODO: Tracing and error logging
                eprintln!("Failed to update message delivery: {e}");
                continue; // Maybe we just break here? Or return early an error?
                // We found them but failed to deliver, but this will all need to be refactored again when multi-device is a thing so... Later problem?
            };
            return Ok(());
        }

        // Wouldn't this send it to multiple servers though if they're connected to multiple? Where the above only sends it to the current due to the return
        // Also if it hits this first, then they're also connect to the current but that's later in the loop, it's delivered twice
        // Potentially intentional?
        router_state
            .redis
            .publish(&rconn_server, &pubsub_payload)
            .await;
    }
    Ok(())
}
