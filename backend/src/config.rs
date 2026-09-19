use std::{env, net::SocketAddr, str::FromStr};

#[derive(Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    pub cookie_secure: bool,
    pub session_hours: i64,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = env::var("DATABASE_URL")?;
        let bind = SocketAddr::from_str(
            &env::var("MEOWCAN_BIND").unwrap_or_else(|_| "127.0.0.1:8080".into()),
        )?;
        let cookie_secure = env::var("MEOWCAN_COOKIE_SECURE")
            .map(|v| v == "true")
            .unwrap_or(true);
        let session_hours = env::var("MEOWCAN_SESSION_HOURS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(168)
            .clamp(1, 2_160);
        Ok(Self {
            bind,
            database_url,
            cookie_secure,
            session_hours,
        })
    }
}
