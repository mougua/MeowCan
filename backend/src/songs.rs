use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::{Any, FromRow, QueryBuilder};

use crate::{
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
