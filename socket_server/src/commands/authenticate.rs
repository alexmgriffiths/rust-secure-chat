use jsonwebtoken::{TokenData, Validation, decode};

use crate::{protocol::Claims, state::RouterState};

pub enum AuthenticateError {
    InvalidToken,
}

pub fn handle_authenticate_command(
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

    router_state
        .connection_to_mailbox
        .insert(client_id, claims.claims.user.id);
    // We need to also append the reverse map
    // If the user already has a hashmap value append
    // If they don't create a hashmap value with a vector of u64 with 1 item
    let mailbox_id = claims.claims.user.id;
    let conns = router_state
        .mailbox_to_connections
        .entry(mailbox_id)
        .or_default();

    if !conns.contains(&client_id) {
        conns.push(client_id);
    }

    Ok(claims.claims.user.id.to_string())
}
