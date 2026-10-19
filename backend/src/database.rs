use std::{str::FromStr, sync::Arc, time::Duration};

use sqlx::{
    Any, AnyPool, Executor, Transaction,
    any::{AnyConnectOptions, AnyPoolOptions},
    migrate::Migrator,
};
use tokio::sync::{Mutex, OwnedMutexGuard};

static MYSQL_MIGRATOR: Migrator = sqlx::migrate!("./migrations");
static SQLITE_MIGRATOR: Migrator = sqlx::migrate!("./migrations-sqlite");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DatabaseKind {
    MySql,
    Sqlite,
}

impl DatabaseKind {
    pub fn from_url(url: &str) -> anyhow::Result<Self> {
        if url.starts_with("mysql://") {
            Ok(Self::MySql)
        } else if url.starts_with("sqlite:") {
            Ok(Self::Sqlite)
        } else {
            anyhow::bail!("DATABASE_URL must use mysql:// or sqlite://")
        }
    }

    pub fn default_max_connections(self) -> u32 {
        match self {
            Self::MySql => 5,
            Self::Sqlite => 4,
        }
    }
}

#[derive(Clone)]
pub struct Database {
    pub pool: AnyPool,
    pub kind: DatabaseKind,
    sqlite_writer: Option<Arc<Mutex<()>>>,
}

impl Database {
    pub async fn connect(url: &str, max_connections: Option<u32>) -> anyhow::Result<Self> {
        sqlx::any::install_default_drivers();
        let kind = DatabaseKind::from_url(url)?;
        let sqlite = kind == DatabaseKind::Sqlite;
        let options = AnyConnectOptions::from_str(url)?;
        let pool = AnyPoolOptions::new()
            .max_connections(max_connections.unwrap_or_else(|| kind.default_max_connections()))
            .acquire_timeout(Duration::from_secs(10))
            .after_connect(move |connection, _| {
                Box::pin(async move {
                    if sqlite {
                        connection.execute("PRAGMA foreign_keys = ON").await?;
                        connection.execute("PRAGMA busy_timeout = 10000").await?;
                        connection.execute("PRAGMA synchronous = NORMAL").await?;
                        connection
                            .execute("PRAGMA wal_autocheckpoint = 1000")
                            .await?;
                    }
                    Ok(())
                })
            })
            .connect_with(options)
            .await?;

        if sqlite {
            let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode = WAL")
                .fetch_one(&pool)
                .await?;
            if !journal_mode.eq_ignore_ascii_case("wal") {
                anyhow::bail!("SQLite WAL mode could not be enabled (got {journal_mode})")
            }
        }

        Ok(Self {
            pool,
            kind,
            sqlite_writer: sqlite.then(|| Arc::new(Mutex::new(()))),
        })
    }

    pub async fn migrate(&self) -> anyhow::Result<()> {
        match self.kind {
            DatabaseKind::MySql => MYSQL_MIGRATOR.run(&self.pool).await?,
            DatabaseKind::Sqlite => {
                // Rebuilding tables must preserve rows referenced by foreign keys.
                let mut connection = self.pool.acquire().await?;
                connection.execute("PRAGMA foreign_keys = OFF").await?;
                let result = SQLITE_MIGRATOR.run(&mut *connection).await;
                connection.execute("PRAGMA foreign_keys = ON").await?;
                result?;
            }
        }
        Ok(())
    }

    /// SQLite permits one writer at a time. Serializing write transactions in
    /// the process avoids lock-upgrade races; busy_timeout remains the fallback
    /// for checkpoints and accidental access from another local process.
    pub async fn write_guard(&self) -> Option<OwnedMutexGuard<()>> {
        match &self.sqlite_writer {
            Some(lock) => Some(lock.clone().lock_owned().await),
            None => None,
        }
    }

    pub async fn begin_write(&self) -> Result<Transaction<'static, Any>, sqlx::Error> {
        match self.kind {
            DatabaseKind::MySql => self.pool.begin().await,
            DatabaseKind::Sqlite => self.pool.begin_with("BEGIN IMMEDIATE").await,
        }
    }

    pub fn now_expression(&self) -> &'static str {
        match self.kind {
            DatabaseKind::MySql => "NOW(6)",
            DatabaseKind::Sqlite => "strftime('%Y-%m-%d %H:%M:%f', 'now')",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn optional_email_migration_preserves_existing_accounts_and_roles() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = format!("target/meowcan-email-migration-{nonce}.db");
        let db = Database::connect(&format!("sqlite://{path}?mode=rwc"), Some(1))
            .await
            .unwrap();
        let mut connection = db.pool.acquire().await.unwrap();
        sqlx::raw_sql(include_str!("../migrations-sqlite/0001_initial.sql"))
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::raw_sql("INSERT INTO users (id, email, display_name, password_hash) VALUES (42, 'old@example.com', 'OldPlayer', 'hash');
            INSERT INTO user_roles (user_id, role_id) SELECT 42, id FROM roles WHERE name = 'player';")
            .execute(&mut *connection).await.unwrap();
        connection
            .execute("PRAGMA foreign_keys = OFF")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../migrations-sqlite/0004_optional_email.sql"))
            .execute(&mut *connection)
            .await
            .unwrap();
        connection
            .execute("PRAGMA foreign_keys = ON")
            .await
            .unwrap();
        let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = 42")
            .fetch_one(&mut *connection)
            .await
            .unwrap();
        assert_eq!(email, "old@example.com");
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_roles WHERE user_id = 42")
            .fetch_one(&mut *connection)
            .await
            .unwrap();
        assert_eq!(count, 1);
        assert!(
            sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(&mut *connection)
                .await
                .unwrap()
                .is_empty()
        );
        drop(connection);
        db.pool.close().await;
        std::fs::remove_file(path).unwrap();
    }
}
