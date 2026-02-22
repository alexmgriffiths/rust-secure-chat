use chrono::Utc;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use std::{env, time::Duration};

use crate::models::{Claims, CreateUserResponse};

pub fn create_jwt(
    user_id: &str,
    user: CreateUserResponse,
) -> Result<String, jsonwebtoken::errors::Error> {
    let secret = env::var("JWT_SECRET").expect("no JWT_SECRET set");
    let now = Utc::now();
    let expiration = now + Duration::from_secs(60 * 60 * 24); // Token valid for 24 hours

    let claims = Claims {
        sub: user_id.to_owned(),
        user,
        iat: now.timestamp() as usize,
        exp: expiration.timestamp() as usize,
    };

    let header = Header::new(Algorithm::HS256);
    let encoding_key = EncodingKey::from_secret(secret.as_bytes());

    encode(&header, &claims, &encoding_key)
}
