use serde::Serialize;
use sqlx::FromRow;

use crate::database::{Database, DatabaseKind};

#[derive(Debug, Serialize)]
pub struct MigrationSummary {
    users: usize,
    roles: usize,
    permissions: usize,
    user_roles: usize,
    role_permissions: usize,
    sessions: usize,
    songs: usize,
    scores: usize,
}

#[derive(FromRow)]
struct UserRecord {
    id: i64,
    email: String,
    display_name: String,
    password_hash: String,
    status: String,
    created_at: String,
    updated_at: String,
}

#[derive(FromRow)]
struct NamedRecord {
    id: i64,
    name: String,
    description: String,
}

#[derive(FromRow)]
struct UserRoleRecord {
    user_id: i64,
    role_id: i64,
    assigned_at: String,
}

#[derive(FromRow)]
struct RolePermissionRecord {
    role_id: i64,
    permission_id: i64,
}

#[derive(FromRow)]
struct SessionRecord {
    id: i64,
    user_id: i64,
    token_hash_hex: String,
    expires_at: String,
    created_at: String,
    last_seen_at: String,
}

#[derive(FromRow)]
struct SongRecord {
    id: i64,
    filename: String,
    genre: String,
    title: String,
    artist: String,
    charter: String,
    level: i64,
    duration_sec: i64,
    notes: i64,
    popularity: i64,
    format: Option<String>,
}

#[derive(FromRow)]
struct ScoreRecord {
    id: i64,
    user_id: i64,
    song_id: i64,
    score: i64,
    accuracy: f64,
    max_combo: i64,
    cool_count: i64,
    good_count: i64,
    bad_count: i64,
    miss_count: i64,
    outcome: String,
    played_at: String,
}

pub async fn mysql_to_sqlite(
    source: &Database,
    target_url: &str,
) -> anyhow::Result<MigrationSummary> {
    if source.kind != DatabaseKind::MySql {
        anyhow::bail!("DATABASE_URL must point to the source MySQL database")
    }
    let target = Database::connect(target_url, Some(1)).await?;
    if target.kind != DatabaseKind::Sqlite {
        anyhow::bail!("the migration target must use a sqlite: URL")
    }
    target.migrate().await?;
    let mut source_tx = source.pool.begin().await?;

    let users = sqlx::query_as::<_, UserRecord>(
        "SELECT id, email, display_name, password_hash, status, \
         DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') created_at, \
         DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') updated_at FROM users ORDER BY id",
    )
    .fetch_all(&mut *source_tx)
    .await?;
    let roles =
        sqlx::query_as::<_, NamedRecord>("SELECT id, name, description FROM roles ORDER BY id")
            .fetch_all(&mut *source_tx)
            .await?;
    let permissions = sqlx::query_as::<_, NamedRecord>(
        "SELECT id, name, description FROM permissions ORDER BY id",
    )
    .fetch_all(&mut *source_tx)
    .await?;
    let user_roles = sqlx::query_as::<_, UserRoleRecord>(
        "SELECT user_id, role_id, DATE_FORMAT(assigned_at, '%Y-%m-%d %H:%i:%s.%f') assigned_at FROM user_roles ORDER BY user_id, role_id",
    )
    .fetch_all(&mut *source_tx)
    .await?;
    let role_permissions = sqlx::query_as::<_, RolePermissionRecord>(
        "SELECT role_id, permission_id FROM role_permissions ORDER BY role_id, permission_id",
    )
    .fetch_all(&mut *source_tx)
    .await?;
    let sessions = sqlx::query_as::<_, SessionRecord>(
        "SELECT id, user_id, HEX(token_hash) token_hash_hex, \
         DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s.%f') expires_at, \
         DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') created_at, \
         DATE_FORMAT(last_seen_at, '%Y-%m-%d %H:%i:%s.%f') last_seen_at FROM sessions ORDER BY id",
    )
    .fetch_all(&mut *source_tx)
    .await?;
    let songs = sqlx::query_as::<_, SongRecord>(
        "SELECT id, filename, genre, title, artist, charter, level, duration_sec, notes, popularity, format FROM songs ORDER BY id",
    )
    .fetch_all(&mut *source_tx)
    .await?;
    let scores = sqlx::query_as::<_, ScoreRecord>(
        "SELECT id, user_id, song_id, score, CAST(accuracy AS DOUBLE) accuracy, max_combo, \
         cool_count, good_count, bad_count, miss_count, outcome, \
         DATE_FORMAT(played_at, '%Y-%m-%d %H:%i:%s.%f') played_at FROM scores ORDER BY id",
    )
    .fetch_all(&mut *source_tx)
    .await?;
    source_tx.commit().await?;

    let summary = MigrationSummary {
        users: users.len(),
        roles: roles.len(),
        permissions: permissions.len(),
        user_roles: user_roles.len(),
        role_permissions: role_permissions.len(),
        sessions: sessions.len(),
        songs: songs.len(),
        scores: scores.len(),
    };

    let _write_guard = target.write_guard().await;
    let mut tx = target.begin_write().await?;
    for table in [
        "scores",
        "sessions",
        "user_roles",
        "role_permissions",
        "songs",
        "users",
        "roles",
        "permissions",
    ] {
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&mut *tx)
            .await?;
    }

    for row in users {
        sqlx::query("INSERT INTO users (id, email, display_name, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(row.id).bind(row.email).bind(row.display_name).bind(row.password_hash)
            .bind(row.status).bind(row.created_at).bind(row.updated_at).execute(&mut *tx).await?;
    }
    for row in roles {
        sqlx::query("INSERT INTO roles (id, name, description) VALUES (?, ?, ?)")
            .bind(row.id)
            .bind(row.name)
            .bind(row.description)
            .execute(&mut *tx)
            .await?;
    }
    for row in permissions {
        sqlx::query("INSERT INTO permissions (id, name, description) VALUES (?, ?, ?)")
            .bind(row.id)
            .bind(row.name)
            .bind(row.description)
            .execute(&mut *tx)
            .await?;
    }
    for row in user_roles {
        sqlx::query("INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES (?, ?, ?)")
            .bind(row.user_id)
            .bind(row.role_id)
            .bind(row.assigned_at)
            .execute(&mut *tx)
            .await?;
    }
    for row in role_permissions {
        sqlx::query("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)")
            .bind(row.role_id)
            .bind(row.permission_id)
            .execute(&mut *tx)
            .await?;
    }
    for row in sessions {
        let token_hash = decode_hex(&row.token_hash_hex)?;
        sqlx::query("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(row.id).bind(row.user_id).bind(token_hash).bind(row.expires_at)
            .bind(row.created_at).bind(row.last_seen_at).execute(&mut *tx).await?;
    }
    for row in songs {
        sqlx::query("INSERT INTO songs (id, filename, genre, title, artist, charter, level, duration_sec, notes, popularity, format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(row.id).bind(row.filename).bind(row.genre).bind(row.title).bind(row.artist)
            .bind(row.charter).bind(row.level).bind(row.duration_sec).bind(row.notes)
            .bind(row.popularity).bind(row.format).execute(&mut *tx).await?;
    }
    for row in scores {
        sqlx::query("INSERT INTO scores (id, user_id, song_id, score, accuracy, max_combo, cool_count, good_count, bad_count, miss_count, outcome, played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(row.id).bind(row.user_id).bind(row.song_id).bind(row.score).bind(row.accuracy)
            .bind(row.max_combo).bind(row.cool_count).bind(row.good_count).bind(row.bad_count)
            .bind(row.miss_count).bind(row.outcome).bind(row.played_at).execute(&mut *tx).await?;
    }
    tx.commit().await?;

    verify_counts(&target, &summary).await?;
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&target.pool)
        .await?;
    Ok(summary)
}

fn decode_hex(value: &str) -> anyhow::Result<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        anyhow::bail!("invalid hexadecimal value length")
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).map_err(Into::into))
        .collect()
}

async fn verify_counts(target: &Database, expected: &MigrationSummary) -> anyhow::Result<()> {
    for (table, expected_count) in [
        ("users", expected.users),
        ("roles", expected.roles),
        ("permissions", expected.permissions),
        ("user_roles", expected.user_roles),
        ("role_permissions", expected.role_permissions),
        ("sessions", expected.sessions),
        ("songs", expected.songs),
        ("scores", expected.scores),
    ] {
        let actual: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&target.pool)
            .await?;
        if actual != expected_count as i64 {
            anyhow::bail!(
                "migration verification failed for {table}: expected {expected_count}, got {actual}"
            )
        }
    }
    Ok(())
}
