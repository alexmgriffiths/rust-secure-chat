use redis::{AsyncCommands, Client, aio::MultiplexedConnection};
use std::collections::HashMap;
use uuid::Uuid;

pub struct RedisHelper {
    conn: MultiplexedConnection,
}

impl RedisHelper {
    pub async fn connect(url: &str) -> Result<Self, redis::RedisError> {
        let conn = Client::open(url)?
            .get_multiplexed_async_connection()
            .await?;
        Ok(Self { conn })
    }

    pub async fn register_connection(&mut self, user_id: Uuid, conn_id: u64, server_id: &str) {
        let key = format!("user:{}:connections", user_id);
        let _: redis::RedisResult<()> = self.conn.hset(&key, conn_id.to_string(), server_id).await;
        let _: redis::RedisResult<()> = self.conn.expire(&key, 90_i64).await;
    }

    pub async fn unregister_connection(&mut self, user_id: Uuid, conn_id: u64) {
        let key = format!("user:{}:connections", user_id);
        let _: redis::RedisResult<()> = self.conn.hdel(&key, conn_id.to_string()).await;
    }

    /// Returns HashMap<ConnectionIdString, ServerIdString>
    pub async fn get_connections(&mut self, user_id: Uuid) -> HashMap<String, String> {
        let key = format!("user:{}:connections", user_id);
        self.conn.hgetall(&key).await.unwrap_or_default()
    }

    pub async fn publish(&mut self, channel: &str, message: &str) {
        let _: redis::RedisResult<()> = self.conn.publish(channel, message).await;
    }
}
