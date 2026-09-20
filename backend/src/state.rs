use crate::database::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub cookie_secure: bool,
    pub session_hours: i64,
}
