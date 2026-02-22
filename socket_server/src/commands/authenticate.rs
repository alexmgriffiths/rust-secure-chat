use jsonwebtoken::{TokenData, Validation, decode};
use uuid::Uuid;

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
    SELECT id, mailbox_id, payload, created_at, delivered_at
    FROM pending_messages
    WHERE mailbox_id = $1
      AND delivered_at IS NULL
    "#,
        mailbox_id
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
    let mut messages_delivered: Vec<Uuid> = vec![];
    for undelivered in undelivered_messages {
        router_state.deliver_to_mailbox(mailbox_id, &undelivered.payload);
        messages_delivered.push(undelivered.id);
    }

    if !messages_delivered.is_empty() {
        if sqlx::query!(
            r#"
        UPDATE pending_messages
        SET delivered_at = now()
        WHERE id = ANY($1)
        "#,
            &messages_delivered[..],
        )
        .execute(&router_state.db)
        .await
        .is_err()
        {
            // Not a massive deal though since they were actually delivered.
            eprintln!("Failed to mark messages as delivered.");
        };
    }

    Ok(mailbox_id.to_string())
}
