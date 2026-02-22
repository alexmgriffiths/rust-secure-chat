use jsonwebtoken::{TokenData, Validation, decode};

use crate::{
    protocol::{Claims, PendingMessage},
    state::RouterState,
};

pub enum AuthenticateError {
    InvalidToken,
    FailedToLoadUndelivered,
}

pub async fn handle_authenticate_command(
    router_state: &mut RouterState,
    client_id: u64,
    token: &str,
    last_seq: i64,
) -> Result<String, AuthenticateError> {
    let claims: TokenData<Claims> =
        match decode::<Claims>(token, &router_state.decoding_key, &Validation::default()) {
            Err(e) => {
                eprintln!("error validating token: {e}");
                return Err(AuthenticateError::InvalidToken);
            }
            Ok(c) => c,
        };
    let mailbox_id = claims.claims.user.id;

    // First lets see if we can get this user's messages
    // If not we can return early as not to break anything
    let undelivered_messages = match sqlx::query_as!(
        PendingMessage,
        r#"
    SELECT id, seq, mailbox_id, payload, created_at, delivered_at
    FROM pending_messages
    WHERE mailbox_id = $1 AND seq > $2 ORDER BY seq ASC
    "#,
        mailbox_id,
        last_seq
    )
    .fetch_all(&router_state.db)
    .await
    {
        Err(e) => {
            eprintln!("failed to load undelivered messages: {e}");
            return Err(AuthenticateError::FailedToLoadUndelivered);
        }
        Ok(u) => u,
    };

    router_state
        .connection_to_mailbox
        .insert(client_id, mailbox_id);
    // We need to also append the reverse map
    // If the user already has a hashmap value append
    // If they don't create a hashmap value with a vector of u64 with 1 item
    let conns = router_state
        .mailbox_to_connections
        .entry(mailbox_id)
        .or_default();

    if !conns.contains(&client_id) {
        conns.push(client_id);
    }

    // Register this user globally
    router_state
        .redis
        .register_connection(mailbox_id, client_id, &router_state.server_id)
        .await;

    // I guess sending undelivered down here is fine, they've already authed
    // Problem is if the delivery fails at any step we're kinda fucked regardless.
    if let Some(tx) = router_state.connections.get(&client_id).cloned() {
        for undelivered in undelivered_messages {
            router_state.send_or_disconnect_server_msg(
                client_id,
                &tx,
                &crate::protocol::ServerMsg::Delivery {
                    seq: undelivered.seq,
                    payload: undelivered.payload,
                },
            );
        }
    }

    Ok(mailbox_id.to_string())
}
