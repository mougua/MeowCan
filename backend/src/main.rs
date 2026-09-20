mod admin;
mod auth;
mod config;
mod data_migration;
mod database;
mod error;
mod scores;
mod songs;
mod state;

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post, put},
};
use config::Config;
use serde_json::{Value, json};
use state::AppState;
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "meowcan_server=info,tower_http=info".into()),
        )
        .init();
    let config = Config::from_env()?;
    let db =
        database::Database::connect(&config.database_url, config.database_max_connections).await?;
    db.migrate().await?;

    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("import-songs") => {
            let path = args
                .get(2)
                .map(String::as_str)
                .unwrap_or("../web/public/songs.json");
            let count = songs::import_catalog(&db, path).await?;
            println!("Imported {count} songs.");
            return Ok(());
        }
        Some("create-admin") => {
            let email = args.get(2).ok_or_else(|| {
                anyhow::anyhow!(
                    "usage: create-admin EMAIL DISPLAY_NAME (password via MEOWCAN_ADMIN_PASSWORD)"
                )
            })?;
            let display_name = args.get(3).ok_or_else(|| {
                anyhow::anyhow!(
                    "usage: create-admin EMAIL DISPLAY_NAME (password via MEOWCAN_ADMIN_PASSWORD)"
                )
            })?;
            let password = std::env::var("MEOWCAN_ADMIN_PASSWORD")
                .map_err(|_| anyhow::anyhow!("MEOWCAN_ADMIN_PASSWORD is required"))?;
            auth::create_admin(&db, email, display_name, password).await?;
            println!("Administrator account is ready.");
            return Ok(());
        }
        Some("migrate-mysql-to-sqlite") => {
            let target_url = args.get(2).ok_or_else(|| {
                anyhow::anyhow!(
                    "usage: migrate-mysql-to-sqlite 'sqlite://data/meowcan.db?mode=rwc'"
                )
            })?;
            let summary = data_migration::mysql_to_sqlite(&db, target_url).await?;
            println!("{}", serde_json::to_string_pretty(&summary)?);
            return Ok(());
        }
        Some(other) if other != "serve" => anyhow::bail!("unknown command: {other}"),
        _ => {}
    }

    let _write_guard = db.write_guard().await;
    let cleanup_sql = format!(
        "DELETE FROM sessions WHERE expires_at <= {}",
        db.now_expression()
    );
    sqlx::query(&cleanup_sql).execute(&db.pool).await?;
    drop(_write_guard);
    let state = AppState {
        db,
        cookie_secure: config.cookie_secure,
        session_hours: config.session_hours,
    };
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(address = %config.bind, "MeowCan API listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/songs", get(songs::list))
        .route("/api/scores", post(scores::submit))
        .route("/api/scores/me", get(scores::mine))
        .route("/api/scores/leaderboard", get(scores::leaderboard))
        .route("/api/admin/users", get(admin::users))
        .route("/api/admin/scores", get(admin::scores))
        .route("/api/admin/users/{id}/roles", put(admin::assign_roles))
        .route("/api/admin/users/{id}/status", put(admin::change_status))
        .route("/api/admin/roles", get(admin::roles))
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> error::ApiResult<Json<Value>> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db.pool)
        .await?;
    Ok(Json(json!({ "status": "ok" })))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler")
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
