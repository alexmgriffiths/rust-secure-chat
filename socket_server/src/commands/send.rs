use uuid::Uuid;

use crate::state::RouterState;

pub enum SendError {}

pub fn handle_send_command(
    router_state: &mut RouterState,
    payload: &str,
    mailbox_id: Uuid,
) -> Result<(), SendError> {
    router_state.deliver_to_mailbox(mailbox_id, payload);
    Ok(())
}
