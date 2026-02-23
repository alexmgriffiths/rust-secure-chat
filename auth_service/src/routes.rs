use axum::{
    Router,
    routing::{get, post},
};
use tower_http::cors::{Any, CorsLayer};

use crate::{
    handlers::{AppState, login, register, root, search, verify},
    key_handlers::{
        get_all_prekey_bundles, get_prekey_bundle, get_user_device_opk_count, list_user_devices,
        upload_device, upload_new_device_opks,
    },
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
        .route("/users/search", get(search))
        .route("/users/{user_id}/devices", post(upload_device))
        .route("/users/{user_id}/keys", get(get_prekey_bundle))
        .route("/users/{user_id}/devices", get(list_user_devices))
        .route("/users/{user_id}/all-keys", get(get_all_prekey_bundles))
        .route(
            "/users/{user_id}/devices/{device_id}/opk-count",
            get(get_user_device_opk_count),
        )
        .route(
            "/users/{user_id}/devices/{device_id}/opks",
            post(upload_new_device_opks),
        )
        .layer(cors)
        .with_state(state)
}
