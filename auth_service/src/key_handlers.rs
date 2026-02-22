use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    handlers::AppState,
    models::{Device, OneTimePreKey},
};

#[derive(Deserialize)]
pub struct UploadDeviceRequest {
    pub device_name: String,
    pub identity_key_ed25519_public: Vec<u8>,
    pub identity_key_x25519_public: Vec<u8>,
    pub signed_prekey_id: i32,
    pub signed_prekey_public: Vec<u8>,
    pub signed_prekey_signature: Vec<u8>,
    pub one_time_prekeys: Vec<OneTimePreKeyUpload>,
}

#[derive(Deserialize)]
pub struct OneTimePreKeyUpload {
    pub key_id: i32,
    pub public_key: Vec<u8>,
}

#[derive(Serialize)]
pub struct UploadDeviceResponse {
    pub device_id: i64,
    pub message: String,
}

#[derive(Serialize)]
pub struct PreKeyBundle {
    pub device_id: i64,
    pub identity_key_ed25519_public: Vec<u8>,
    pub identity_key_x25519_public: Vec<u8>,
    pub signed_prekey_id: i32,
    pub signed_prekey_public: Vec<u8>,
    pub signed_prekey_signature: Vec<u8>,
    pub one_time_prekey: Option<OneTimePreKeyResponse>,
}

#[derive(Serialize)]
pub struct OneTimePreKeyResponse {
    pub key_id: i32,
    pub public_key: Vec<u8>,
}

/// Upload a new device with its cryptographic keys
pub async fn upload_device(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UploadDeviceRequest>,
) -> impl IntoResponse {
    // First, insert the device
    let device_result = sqlx::query_as::<_, Device>(
        r#"
        INSERT INTO devices (user_id, device_name, identity_key_ed25519_public, identity_key_x25519_public, signed_prekey_id, signed_prekey_public, signed_prekey_signature)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, user_id, device_name, identity_key_ed25519_public, identity_key_x25519_public, signed_prekey_id, signed_prekey_public, signed_prekey_signature, created_at
        "#,
    )
    .bind(user_id)
    .bind(&payload.device_name)
    .bind(&payload.identity_key_ed25519_public)
    .bind(&payload.identity_key_x25519_public)
    .bind(payload.signed_prekey_id)
    .bind(&payload.signed_prekey_public)
    .bind(&payload.signed_prekey_signature)
    .fetch_one(&state.db)
    .await;

    let device = match device_result {
        Ok(d) => d,
        Err(err) => {
            let msg = format!("Failed to create device: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response();
        }
    };

    // Insert one-time prekeys
    for prekey in &payload.one_time_prekeys {
        let _ = sqlx::query(
            "INSERT INTO one_time_prekeys (device_id, key_id, public_key) VALUES ($1, $2, $3)",
        )
        .bind(device.id)
        .bind(prekey.key_id)
        .bind(&prekey.public_key)
        .execute(&state.db)
        .await;
        // Ignore errors for PoC - in production, you'd handle this properly
    }

    (
        StatusCode::CREATED,
        Json(UploadDeviceResponse {
            device_id: device.id,
            message: format!(
                "Device created with {} one-time prekeys",
                payload.one_time_prekeys.len()
            ),
        }),
    )
        .into_response()
}

pub async fn get_all_prekey_bundles(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    let devices_result = sqlx::query_as::<_, Device>(
        "SELECT id, user_id, device_name,
                identity_key_ed25519_public, identity_key_x25519_public,
                signed_prekey_id, signed_prekey_public, signed_prekey_signature,
                created_at
         FROM devices
         WHERE user_id = $1
         ORDER BY created_at DESC",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await;

    let devices = match devices_result {
        Ok(d) if !d.is_empty() => d,
        Ok(_) => return (StatusCode::NOT_FOUND, "No devices found for user").into_response(),
        Err(err) => {
            let msg = format!("Failed to fetch devices: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response();
        }
    };

    let mut bundles: Vec<PreKeyBundle> = Vec::with_capacity(devices.len());

    for device in devices {
        // Consume exactly 1 OTPK for this device (if any)
        let otpk = sqlx::query_as::<_, OneTimePreKey>(
            "DELETE FROM one_time_prekeys
             WHERE id = (
                SELECT id
                FROM one_time_prekeys
                WHERE device_id = $1
                ORDER BY created_at ASC
                LIMIT 1
             )
             RETURNING id, device_id, key_id, public_key, created_at",
        )
        .bind(device.id)
        .fetch_optional(&state.db)
        .await;

        let otpk = match otpk {
            Ok(v) => v, // Option<OneTimePreKey>
            Err(err) => {
                let msg = format!(
                    "Failed to consume one-time prekey for device {}: {}",
                    device.id, err
                );
                return (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response();
            }
        };

        bundles.push(PreKeyBundle {
            device_id: device.id,
            identity_key_ed25519_public: device.identity_key_ed25519_public,
            identity_key_x25519_public: device.identity_key_x25519_public,
            signed_prekey_id: device.signed_prekey_id,
            signed_prekey_public: device.signed_prekey_public,
            signed_prekey_signature: device.signed_prekey_signature,
            one_time_prekey: otpk.map(|k| OneTimePreKeyResponse {
                key_id: k.key_id,
                public_key: k.public_key,
            }),
        });
    }

    (StatusCode::OK, Json(bundles)).into_response()
}

/// Fetch a prekey bundle for a user (for establishing encrypted session)
/// This consumes one one-time prekey if available
pub async fn get_prekey_bundle(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    // For PoC: just get the first device for this user
    // In production: handle multiple devices
    let device_result = sqlx::query_as::<_, Device>(
        "SELECT id, user_id, device_name, identity_key_ed25519_public, identity_key_x25519_public, signed_prekey_id, signed_prekey_public, signed_prekey_signature, created_at 
         FROM devices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await;

    let device = match device_result {
        Ok(d) => d,
        Err(_) => {
            return (StatusCode::NOT_FOUND, "No device found for user").into_response();
        }
    };

    // Try to get and consume one one-time prekey
    let one_time_prekey = sqlx::query_as::<_, OneTimePreKey>(
        "DELETE FROM one_time_prekeys WHERE id = (
            SELECT id FROM one_time_prekeys WHERE device_id = $1 LIMIT 1
         ) RETURNING id, device_id, key_id, public_key, created_at",
    )
    .bind(device.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let bundle = PreKeyBundle {
        device_id: device.id,
        identity_key_ed25519_public: device.identity_key_ed25519_public,
        identity_key_x25519_public: device.identity_key_x25519_public,
        signed_prekey_id: device.signed_prekey_id,
        signed_prekey_public: device.signed_prekey_public,
        signed_prekey_signature: device.signed_prekey_signature,
        one_time_prekey: one_time_prekey.map(|otpk| OneTimePreKeyResponse {
            key_id: otpk.key_id,
            public_key: otpk.public_key,
        }),
    };

    (StatusCode::OK, Json(bundle)).into_response()
}

/// Get list of devices for a user (useful for multi-device)
pub async fn list_user_devices(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    let devices = sqlx::query_as::<_, Device>(
        "SELECT id, user_id, device_name, identity_key_ed25519_public, identity_key_x25519_public, signed_prekey_id, signed_prekey_public, signed_prekey_signature, created_at 
         FROM devices WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await;

    match devices {
        Ok(devices) => (StatusCode::OK, Json(devices)).into_response(),
        Err(err) => {
            let msg = format!("Failed to fetch devices: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response()
        }
    }
}
