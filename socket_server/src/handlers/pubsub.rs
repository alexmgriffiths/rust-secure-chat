use uuid::Uuid;

use crate::state::RouterState;

// I don't think we need to check for the client or anything locally
// If this function gets called it's probably trigger by the redis subscriber
pub async fn handle_pubsub_delivery_event(
    router_state: &mut RouterState,
    mailbox_id: Uuid,
    seq: i64,
    payload: String,
    message_id: Uuid,
) {
    router_state.deliver_to_mailbox(mailbox_id, seq, &payload);

    // We can probably remove this, but it'll probably be handle for debugging and later
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
        return;
    };
}
