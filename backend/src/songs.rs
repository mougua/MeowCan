use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::{Any, FromRow, QueryBuilder};

use crate::{
    auth::AuthUser,
    database::{Database, DatabaseKind},
    error::ApiResult,
    state::AppState,
};

#[derive(Clone, Debug, Deserialize, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: i64,
    pub filename: String,
    pub genre: String,
    pub title: String,
    pub artist: String,
    pub charter: String,
    pub level: i64,
    pub duration_sec: i64,
    pub notes: i64,
    pub popularity: i64,
    pub format: Option<String>,
}

#[derive(Deserialize)]
pub struct SongQuery {
    q: Option<String>,
    levels: Option<String>,
    genre: Option<String>,
    sort: Option<String>,
    order: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongPage {
    items: Vec<Song>,
    limit: u32,
    offset: u32,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopularSong {
    song_id: i64,
    play_count: i64,
    top_player_name: Option<String>,
}

pub async fn popular(State(state): State<AppState>) -> ApiResult<Json<Vec<PopularSong>>> {
    let items = sqlx::query_as::<_, PopularSong>(
        "SELECT p.song_id, p.play_count, leader.display_name top_player_name FROM \
         (SELECT song_id, COUNT(*) play_count FROM score_submissions GROUP BY song_id) p \
         LEFT JOIN ( \
           SELECT song_id, display_name FROM ( \
             SELECT s.song_id, u.display_name, ROW_NUMBER() OVER ( \
               PARTITION BY s.song_id ORDER BY s.score DESC, s.accuracy DESC, s.max_combo DESC, s.played_at ASC, s.id ASC \
             ) song_position FROM scores s JOIN users u ON u.id = s.user_id WHERE s.accuracy >= 80 \
           ) ranked WHERE song_position = 1 \
         ) leader ON leader.song_id = p.song_id \
         ORDER BY p.play_count DESC, p.song_id ASC",
    )
    .fetch_all(&state.db.pool)
    .await?;
    Ok(Json(items))
}

pub async fn popular_mine(
    user: AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<PopularSong>>> {
    user.require("score:read:self")?;
    let items = sqlx::query_as::<_, PopularSong>(
        "SELECT p.song_id, p.play_count, ( \
           SELECT u.display_name FROM scores s JOIN users u ON u.id = s.user_id \
           WHERE s.song_id = p.song_id AND s.accuracy >= 80 \
           ORDER BY s.score DESC, s.accuracy DESC, s.max_combo DESC, s.played_at ASC, s.id ASC LIMIT 1 \
         ) top_player_name FROM ( \
           SELECT song_id, COUNT(*) play_count FROM score_submissions WHERE user_id = ? GROUP BY song_id \
         ) p ORDER BY p.play_count DESC, p.song_id ASC",
    )
    .bind(user.id)
    .fetch_all(&state.db.pool)
    .await?;
    Ok(Json(items))
}

pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<SongQuery>,
) -> ApiResult<Json<SongPage>> {
    let limit = query.limit.unwrap_or(10_000).clamp(1, 10_000);
    let offset = query.offset.unwrap_or(0);
    let levels: Vec<i64> = query
        .levels
        .as_deref()
        .unwrap_or("")
        .split(',')
        .filter_map(|value| value.parse().ok())
        .filter(|value| (1..=99).contains(value))
        .collect();

    let mut sql = QueryBuilder::<Any>::new(
        "SELECT id, filename, genre, title, artist, charter, level, duration_sec, notes, popularity, format FROM songs WHERE 1=1",
    );
    if let Some(term) = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let like = format!("%{term}%");
        sql.push(" AND (title LIKE ")
            .push_bind(like.clone())
            .push(" OR artist LIKE ")
            .push_bind(like.clone())
            .push(" OR charter LIKE ")
            .push_bind(like.clone())
            .push(match state.db.kind {
                DatabaseKind::MySql => " OR CAST(id AS CHAR) LIKE ",
                DatabaseKind::Sqlite => " OR CAST(id AS TEXT) LIKE ",
            })
            .push_bind(like)
            .push(")");
    }
    if let Some(genre) = query
        .genre
        .as_deref()
        .filter(|value| *value != "all" && *value != "所有" && !value.is_empty())
    {
        sql.push(" AND genre = ").push_bind(genre.to_lowercase());
    }
    if !levels.is_empty() {
        sql.push(" AND level IN (");
        let mut separated = sql.separated(", ");
        for level in levels {
            separated.push_bind(level);
        }
        separated.push_unseparated(")");
    }
    let sort = match query.sort.as_deref() {
        Some("id") => "id",
        Some("title") => "title",
        Some("level") => "level",
        Some("duration") => "duration_sec",
        Some("notes") => "notes",
        _ => "popularity",
    };
    let order = if query.order.as_deref() == Some("asc") {
        "ASC"
    } else {
        "DESC"
    };
    sql.push(" ORDER BY ")
        .push(sort)
        .push(" ")
        .push(order)
        .push(", id ASC LIMIT ")
        .push_bind(i64::from(limit))
        .push(" OFFSET ")
        .push_bind(i64::from(offset));
    let items = sql
        .build_query_as::<Song>()
        .fetch_all(&state.db.pool)
        .await?;
    Ok(Json(SongPage {
        items,
        limit,
        offset,
    }))
}

pub async fn import_catalog(db: &Database, path: &str) -> anyhow::Result<usize> {
    let content = tokio::fs::read_to_string(path).await?;
    let songs: Vec<Song> = serde_json::from_str(&content)?;
    let _write_guard = db.write_guard().await;
    let mut tx = db.begin_write().await?;
    for chunk in songs.chunks(50) {
        let mut query = QueryBuilder::<Any>::new(
            "INSERT INTO songs (id, filename, genre, title, artist, charter, level, duration_sec, notes, popularity, format) ",
        );
        query.push_values(chunk, |mut row, song| {
            row.push_bind(song.id)
                .push_bind(&song.filename)
                .push_bind(&song.genre)
                .push_bind(&song.title)
                .push_bind(&song.artist)
                .push_bind(&song.charter)
                .push_bind(song.level)
                .push_bind(song.duration_sec)
                .push_bind(song.notes)
                .push_bind(song.popularity)
                .push_bind(&song.format);
        });
        query.push(match db.kind {
            DatabaseKind::MySql => " AS incoming ON DUPLICATE KEY UPDATE filename=incoming.filename, genre=incoming.genre, \
                title=incoming.title, artist=incoming.artist, charter=incoming.charter, level=incoming.level, \
                duration_sec=incoming.duration_sec, notes=incoming.notes, popularity=incoming.popularity, format=incoming.format",
            DatabaseKind::Sqlite => " ON CONFLICT(id) DO UPDATE SET filename=excluded.filename, genre=excluded.genre, \
                title=excluded.title, artist=excluded.artist, charter=excluded.charter, level=excluded.level, \
                duration_sec=excluded.duration_sec, notes=excluded.notes, popularity=excluded.popularity, format=excluded.format",
        });
        query.build().execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(songs.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn popular_song_tabs_include_score_leader_name() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = format!("target/meowcan-popular-leader-{nonce}.db");
        let db = Database::connect(&format!("sqlite://{path}?mode=rwc"), Some(2))
            .await
            .unwrap();
        db.migrate().await.unwrap();
        for id in 1..=2 {
            sqlx::query("INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, 'unused')")
                .bind(id).bind(format!("{id}@example.com")).bind(format!("Player {id}"))
                .execute(&db.pool).await.unwrap();
            sqlx::query("INSERT INTO songs (id, filename, title) VALUES (?, ?, ?)")
                .bind(id)
                .bind(format!("{id}.vos"))
                .bind(format!("Song {id}"))
                .execute(&db.pool)
                .await
                .unwrap();
        }
        for (user_id, submission_id, song_id) in [(1, "one", 1), (2, "two", 1), (1, "three", 2)] {
            sqlx::query("INSERT INTO score_submissions (user_id, submission_id, song_id, saved) VALUES (?, ?, ?, 1)")
                .bind(user_id).bind(submission_id).bind(song_id)
                .execute(&db.pool).await.unwrap();
        }
        for (user_id, score, accuracy) in [(1, 100, 90.0), (2, 110, 90.0), (1, 200, 79.0)] {
            sqlx::query("INSERT INTO scores (user_id, song_id, score, accuracy, max_combo, cool_count, good_count, bad_count, miss_count, outcome) VALUES (?, 1, ?, ?, 1, 1, 0, 0, 0, 'clear')")
                .bind(user_id).bind(score).bind(accuracy).execute(&db.pool).await.unwrap();
        }
        let state = AppState {
            db,
            session_hours: 24,
            cookie_secure: false,
        };
        let Json(rows) = popular(State(state.clone())).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].song_id, rows[0].play_count), (1, 2));
        assert_eq!(rows[0].top_player_name.as_deref(), Some("Player 2"));
        assert_eq!(rows[1].top_player_name, None);
        let user = AuthUser {
            id: 1,
            email: "1@example.com".into(),
            display_name: "Player 1".into(),
            roles: vec!["player".into()],
            permissions: vec!["score:read:self".into()],
        };
        let Json(mine) = popular_mine(user, State(state.clone())).await.unwrap();
        assert_eq!(mine.len(), 2);
        assert_eq!((mine[0].song_id, mine[0].play_count), (1, 1));
        assert_eq!(mine[0].top_player_name.as_deref(), Some("Player 2"));
        assert_eq!(mine[1].top_player_name, None);
        state.db.pool.close().await;
        drop(state);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{path}-shm"));
        let _ = std::fs::remove_file(format!("{path}-wal"));
    }
}
