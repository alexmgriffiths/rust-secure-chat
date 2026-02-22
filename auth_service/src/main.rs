mod db;
mod handlers;
mod jwt;
pub mod key_handlers;
mod models;
mod routes;

use crate::{db::connect, handlers::AppState, routes::create_router};
use std::env;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL not set");
    let pool = connect(&database_url).await;

    let state = AppState { db: pool };
    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
