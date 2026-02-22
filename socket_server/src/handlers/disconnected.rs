use crate::state::RouterState;

pub async fn handle_disconnected_event(router_state: &mut RouterState, client_id: u64) {
    // If the user has a mailbox connected
    // router_state.redis.unregister_connection
    if let Some(c) = router_state.connection_to_mailbox.get(&client_id) {
        router_state
            .redis
            .unregister_connection(*c, client_id)
            .await;
    };
    router_state.disconnect_client(client_id);
}
