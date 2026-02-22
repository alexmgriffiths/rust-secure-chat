use uuid::Uuid;

use crate::commands::authenticate::handle_authenticate_command;
use crate::commands::send::handle_send_command;
use crate::protocol::ServerMsg;
use crate::{protocol::Command, state::RouterState};

pub async fn handle_received_event(
    router_state: &mut RouterState,
    client_id: u64,
    command: Command,
) {
    let Some(tx) = router_state.connections.get(&client_id).cloned() else {
        return;
    };
    match command {
        Command::Authenticate { token } => {
            // If the user is already authenticated, ignore this command
            if router_state.connection_to_mailbox.contains_key(&client_id) {
                router_state.send_or_disconnect_server_msg(
                    client_id,
                    &tx,
                    &ServerMsg::Error {
                        message: "REAUTH FORBIDDEN".to_string(),
                    },
                );
                return;
            }
            let user_id = match handle_authenticate_command(router_state, client_id, &token).await {
                Err(_) => {
                    // TODO: Handle actual error rather than hard-coding maybe
                    router_state.send_or_disconnect_server_msg(
                        client_id,
                        &tx,
                        &ServerMsg::Error {
                            message: "AUTH FAILED".to_string(),
                        },
                    );
                    return;
                }
                Ok(user_id) => user_id,
            };
            router_state.send_or_disconnect_server_msg(
                client_id,
                &tx,
                &ServerMsg::Info {
                    message: format!("AUTH OK {user_id}"),
                },
            );
        }
        Command::Send {
            mailbox_id,
            payload,
            message_id,
        } => {
            // We need to make sure the current user is authed
            if !router_state.connection_to_mailbox.contains_key(&client_id) {
                router_state.send_or_disconnect_server_msg(
                    client_id,
                    &tx,
                    &ServerMsg::Error {
                        message: "UNAUTHENTICATED".to_string(),
                    },
                );
                return;
            }

            let parsed_mailbox_id = match Uuid::try_parse(&mailbox_id) {
                Ok(m) => m,
                Err(_) => {
                    router_state.send_or_disconnect_server_msg(
                        client_id,
                        &tx,
                        &ServerMsg::Error {
                            message: "Failed to parse mailbox".to_string(),
                        },
                    );
                    return;
                }
            };

            let parsed_message_id = match Uuid::try_parse(&message_id) {
                Ok(mid) => mid,
                Err(_) => {
                    router_state.send_or_disconnect_server_msg(
                        client_id,
                        &tx,
                        &ServerMsg::Error {
                            message: "Failed to parse message_id".to_string(),
                        },
                    );
                    return;
                }
            };

            // TODO: Error handling in this function so that it can actually return an error
            if handle_send_command(
                router_state,
                &payload,
                parsed_mailbox_id,
                parsed_message_id,
                client_id,
            )
            .await
            .is_err()
            {
                router_state.send_or_disconnect_server_msg(
                    client_id,
                    &tx,
                    &ServerMsg::Error {
                        message: "Failed to send message".to_string(),
                    },
                );
                return;
            };
        }
    }
}
