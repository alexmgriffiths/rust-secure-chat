use axum::{
    Router,
    routing::{get, post},
};
use tower_http::cors::{Any, CorsLayer};

use crate::{
    handlers::{AppState, login, register, root, verify},
    key_handlers::{get_prekey_bundle, list_user_devices, upload_device},
};

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/", get(root))
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/verify", post(verify))
        .route("/users/{user_id}/devices", post(upload_device))
        .route("/users/{user_id}/keys", get(get_prekey_bundle))
        .route("/users/{user_id}/devices", get(list_user_devices))
        .layer(cors)
        .with_state(state)
}
