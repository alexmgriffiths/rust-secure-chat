use serde::{Deserialize, Serialize};
use sqlx::{
    prelude::FromRow,
    types::chrono::{DateTime, Utc},
};
use uuid::Uuid;

#[derive(Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub password_hash: String,

    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,

    #[serde(with = "chrono::serde::ts_seconds")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize, FromRow, Deserialize)]
pub struct CreateUserResponse {
    pub id: Uuid,
    pub username: String,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,

    #[serde(with = "chrono::serde::ts_seconds")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub id: Uuid,
    pub username: String,
    pub token: String,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,

    #[serde(with = "chrono::serde::ts_seconds")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
pub struct Device {
    pub id: i64,
    pub user_id: Uuid,
    pub device_name: String,
    pub identity_key_ed25519_public: Vec<u8>,
    pub identity_key_x25519_public: Vec<u8>,
    pub signed_prekey_id: i32,
    pub signed_prekey_public: Vec<u8>,
    pub signed_prekey_signature: Vec<u8>,

    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
pub struct OneTimePreKey {
    pub id: i64,
    pub device_id: i64,
    pub key_id: i32,
    pub public_key: Vec<u8>,

    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub user: CreateUserResponse,
    pub exp: usize,
    pub iat: usize,
}

#[derive(Deserialize)]
pub struct VerifyRequest {
    pub token: String,
}

#[derive(Serialize)]
pub struct GenericServerError {
    pub code: i32,
    pub message: String,
}

#[derive(Deserialize)]
pub struct UsernameSearchRequest {
    pub q: String,
}

#[derive(Serialize, Deserialize)]
pub struct UsernameSearchResult {
    pub id: Uuid,
    pub username: String,
}
