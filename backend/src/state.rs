use sqlx::MySqlPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: MySqlPool,
    pub cookie_secure: bool,
    pub session_hours: i64,
}
