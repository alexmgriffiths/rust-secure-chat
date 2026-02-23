use std::env;

use argon2::{
    Argon2, PasswordHash, PasswordVerifier,
    password_hash::{PasswordHasher, SaltString, rand_core::OsRng},
};
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use jsonwebtoken::{DecodingKey, Validation, decode};
use uuid::Uuid;

use crate::{
    db::DbPool,
    jwt::create_jwt,
    models::{
        Claims, CreateUserRequest, CreateUserResponse, GenericServerError, LoginResponse, User,
        UsernameSearchRequest, UsernameSearchResult, VerifyRequest,
    },
};

#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
}

pub async fn root() -> &'static str {
    "Boo!"
}

pub async fn register(
    State(state): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> impl IntoResponse {
    let id = Uuid::new_v4();
    let hashed_password = hash_password(&payload.password);
    let res = sqlx::query_as::<_, CreateUserResponse>(
        "INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) RETURNING id, username, created_at, updated_at",
    ).bind(id).bind(&payload.username).bind(hashed_password).fetch_one(&state.db).await;

    match res {
        Ok(user) => (
            StatusCode::CREATED,
            Json(CreateUserResponse {
                id: user.id,
                username: user.username,
                created_at: user.created_at,
                updated_at: user.updated_at,
            }),
        )
            .into_response(),
        Err(err) => {
            // Basic error mapping
            let msg = format!("DB Error: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response()
        }
    }
}

// TODO: Solve timing attack vulnerability and better db error handling
pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<CreateUserRequest>, // Same structure as create, just username and password, for now
) -> impl IntoResponse {
    let res = sqlx::query_as::<_, User>(
        "SELECT id, username, password_hash, created_at, updated_at FROM users WHERE username = $1",
    )
    .bind(&payload.username)
    .fetch_one(&state.db)
    .await;
    let user = match res {
        Ok(user) => user,
        Err(err) => {
            let msg = format!("DB Error: {}", err);
            return (StatusCode::UNAUTHORIZED, msg).into_response();
        }
    };
    if !verify_password(&payload.password, &user.password_hash) {
        return (StatusCode::UNAUTHORIZED, "Invalid username or password").into_response();
    }

    let token = match create_jwt(
        &user.id.to_string(),
        CreateUserResponse {
            username: user.username.clone(),
            created_at: user.created_at,
            updated_at: user.updated_at,
            id: user.id,
        },
    ) {
        Ok(token) => token,
        Err(e) => {
            let msg = format!("Token Error: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response();
        }
    };

    (
        StatusCode::OK,
        Json(LoginResponse {
            id: user.id,
            username: user.username,
            token: token,
            created_at: user.created_at,
            updated_at: user.updated_at,
        }),
    )
        .into_response()
}

pub async fn verify(Json(payload): Json<VerifyRequest>) -> impl IntoResponse {
    let claims = match decode::<Claims>(
        &payload.token,
        &DecodingKey::from_secret(env::var("JWT_SECRET").expect("no JWT_SECRET set").as_ref()),
        &Validation::default(),
    ) {
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(GenericServerError {
                    code: 401,
                    message: e.to_string(),
                }),
            )
                .into_response();
        }
        Ok(c) => c,
    };
    (
        StatusCode::OK,
        Json(CreateUserResponse {
            created_at: claims.claims.user.created_at,
            updated_at: claims.claims.user.updated_at,
            id: claims.claims.user.id,
            username: claims.claims.user.username,
        }),
    )
        .into_response()
}

// TODO: Add auth to all these endpoints or at least rate-limits
// TODO: Make it so they have to search for >=3 characters
pub async fn search(
    State(state): State<AppState>,
    Query(params): Query<UsernameSearchRequest>,
) -> impl IntoResponse {
    let results = match sqlx::query_as!(
        UsernameSearchResult,
        r#"
        SELECT id, username FROM users WHERE username ILIKE $1 || '%' OR similarity(username, $1) > 0.3
        ORDER BY similarity(username, $1) DESC LIMIT 10
    "#, params.q
    ).fetch_all(&state.db).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Get users error: {e}");
            return (
                StatusCode::UNAUTHORIZED,
                Json(GenericServerError {
                    code: 500,
                    message: e.to_string(),
                }),
            )
                .into_response();
        }
    };

    (StatusCode::OK, Json(results)).into_response()
}

// TODO: move to helper
fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .expect("Failed to hash password")
        .serialize();
    password_hash.to_string()
}

fn verify_password(password: &str, stored_hash: &str) -> bool {
    let parsed_hash = PasswordHash::new(stored_hash).expect("Invalid hash");
    let argon2 = Argon2::default();
    argon2
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}
