use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::{Any, FromRow};

use crate::{
    auth::AuthUser,
    database::DatabaseKind,
    error::{ApiError, ApiResult},
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitScore {
    submission_id: Option<String>,
    song_id: i64,
    score: i64,
    accuracy: f64,
    max_combo: i64,
    cool_count: i64,
    good_count: i64,
    bad_count: i64,
    miss_count: i64,
    outcome: String,
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    id: i64,
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

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    user_id: i64,
    display_name: String,
    score: i64,
    accuracy: f64,
    max_combo: i64,
    played_at: String,
}

#[derive(Deserialize)]
pub struct ScoreQuery {
    song_id: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitResponse {
    saved: bool,
    top_scores: Vec<Score>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardResponse {
    mine: Vec<LeaderboardEntry>,
    global: Vec<LeaderboardEntry>,
}

pub async fn submit(
    user: AuthUser,
    State(state): State<AppState>,
    Json(input): Json<SubmitScore>,
) -> ApiResult<Json<SubmitResponse>> {
    user.require("score:create")?;
    validate(&input)?;
    let _write_guard = state.db.write_guard().await;
    let mut tx = state.db.begin_write().await?;
    // Serialize submissions per player so concurrent finishes cannot leave more than ten rows.
    let lock_sql = match state.db.kind {
        DatabaseKind::MySql => "SELECT id FROM users WHERE id = ? FOR UPDATE",
        DatabaseKind::Sqlite => "SELECT id FROM users WHERE id = ?",
    };
    sqlx::query(lock_sql)
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await?;
    if let Some(submission_id) = &input.submission_id {
        let previous: Option<(i64, i64)> = sqlx::query_as(
            "SELECT song_id, saved + 0 FROM score_submissions WHERE user_id = ? AND submission_id = ?",
        )
        .bind(user.id)
        .bind(submission_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((song_id, saved)) = previous {
            if song_id != input.song_id {
                return Err(ApiError::BadRequest(
                    "submission ID belongs to another song".into(),
                ));
            }
            let top_scores =
                fetch_top(&mut *tx, state.db.kind, user.id, Some(input.song_id)).await?;
            tx.commit().await?;
            return Ok(Json(SubmitResponse {
                saved: saved != 0,
                top_scores,
            }));
        }
    }
    let exists = sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM songs WHERE id = ?)")
        .bind(input.song_id)
        .fetch_one(&mut *tx)
        .await?
        != 0;
    if !exists {
        return Err(ApiError::NotFound);
    }
    if !is_leaderboard_eligible(input.accuracy) {
        record_submission(&mut tx, user.id, &input, false).await?;
        let top_scores = fetch_top(&mut *tx, state.db.kind, user.id, Some(input.song_id)).await?;
        tx.commit().await?;
        return Ok(Json(SubmitResponse {
            saved: false,
            top_scores,
        }));
    }
    let result = sqlx::query(
        "INSERT INTO scores (user_id, song_id, score, accuracy, max_combo, cool_count, good_count, bad_count, miss_count, outcome) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(user.id).bind(input.song_id).bind(input.score).bind(input.accuracy).bind(input.max_combo)
        .bind(input.cool_count).bind(input.good_count).bind(input.bad_count).bind(input.miss_count)
        .bind(&input.outcome).execute(&mut *tx).await?;
    let inserted_id = match result.last_insert_id().filter(|id| *id > 0) {
        Some(id) => id,
        None => {
            sqlx::query_scalar("SELECT last_insert_rowid()")
                .fetch_one(&mut *tx)
                .await?
        }
    };

    sqlx::query(
        "DELETE FROM scores WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER \
         (ORDER BY score DESC, accuracy DESC, max_combo DESC, played_at ASC, id ASC) AS position \
         FROM scores WHERE user_id = ? AND song_id = ?) ranked WHERE position > 10)",
    )
    .bind(user.id)
    .bind(input.song_id)
    .execute(&mut *tx)
    .await?;
    let saved = sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM scores WHERE id = ?)")
        .bind(inserted_id)
        .fetch_one(&mut *tx)
        .await?
        != 0;
    record_submission(&mut tx, user.id, &input, saved).await?;
    let top_scores = fetch_top(&mut *tx, state.db.kind, user.id, Some(input.song_id)).await?;
    tx.commit().await?;
    Ok(Json(SubmitResponse { saved, top_scores }))
}

async fn record_submission(
    tx: &mut sqlx::Transaction<'_, Any>,
    user_id: i64,
    input: &SubmitScore,
    saved: bool,
) -> Result<(), sqlx::Error> {
    if let Some(submission_id) = &input.submission_id {
        sqlx::query(
            "INSERT INTO score_submissions (user_id, submission_id, song_id, saved) VALUES (?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(submission_id)
        .bind(input.song_id)
        .bind(i64::from(saved))
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

pub async fn leaderboard(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<ScoreQuery>,
) -> ApiResult<Json<LeaderboardResponse>> {
    user.require("score:read:self")?;
    let song_id = query
        .song_id
        .ok_or_else(|| ApiError::BadRequest("song_id is required".into()))?;

    let played_at = timestamp_sql(state.db.kind, "s.played_at");
    let mine_sql = format!(
        "SELECT s.user_id, u.display_name, s.score, CAST(s.accuracy AS DOUBLE) accuracy, s.max_combo, \
         {played_at} played_at \
         FROM scores s JOIN users u ON u.id = s.user_id \
         WHERE s.user_id = ? AND s.song_id = ? AND s.accuracy >= 80 \
         ORDER BY s.score DESC, s.accuracy DESC, s.max_combo DESC, s.played_at ASC, s.id ASC LIMIT 10"
    );
    let mine = sqlx::query_as::<_, LeaderboardEntry>(&mine_sql)
        .bind(user.id)
        .bind(song_id)
        .fetch_all(&state.db.pool)
        .await?;

    // A player's best result is their only global entry, so one person cannot fill the board.
    let global_sql = format!(
        "SELECT user_id, display_name, score, accuracy, max_combo, played_at FROM (\
           SELECT s.id, s.user_id, u.display_name, s.score, CAST(s.accuracy AS DOUBLE) accuracy, s.max_combo, \
             {played_at} played_at, \
             ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.score DESC, s.accuracy DESC, s.max_combo DESC, s.played_at ASC, s.id ASC) player_position \
           FROM scores s JOIN users u ON u.id = s.user_id \
           WHERE s.song_id = ? AND s.accuracy >= 80\
         ) ranked WHERE player_position = 1 \
         ORDER BY score DESC, accuracy DESC, max_combo DESC, played_at ASC, id ASC LIMIT 10"
    );
    let global = sqlx::query_as::<_, LeaderboardEntry>(&global_sql)
        .bind(song_id)
        .fetch_all(&state.db.pool)
        .await?;

    Ok(Json(LeaderboardResponse { mine, global }))
}

pub async fn mine(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<ScoreQuery>,
) -> ApiResult<Json<Vec<Score>>> {
    user.require("score:read:self")?;
    Ok(Json(
        fetch_top(&state.db.pool, state.db.kind, user.id, query.song_id).await?,
    ))
}

async fn fetch_top<'e, E>(
    executor: E,
    kind: DatabaseKind,
    user_id: i64,
    song_id: Option<i64>,
) -> Result<Vec<Score>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = Any>,
{
    let played_at = timestamp_sql(kind, "played_at");
    let sql = format!(
        "SELECT id, song_id, score, CAST(accuracy AS DOUBLE) accuracy, max_combo, cool_count, good_count, bad_count, miss_count, \
         outcome, {played_at} played_at FROM scores \
         WHERE user_id = ? AND (? IS NULL OR song_id = ?) \
         ORDER BY song_id ASC, score DESC, accuracy DESC, max_combo DESC, played_at ASC LIMIT 500"
    );
    sqlx::query_as::<_, Score>(&sql)
        .bind(user_id)
        .bind(song_id)
        .bind(song_id)
        .fetch_all(executor)
        .await
}

fn validate(input: &SubmitScore) -> ApiResult<()> {
    if input.submission_id.as_ref().is_some_and(|id| {
        id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    }) {
        return Err(ApiError::BadRequest("invalid submission ID".into()));
    }
    let counts = [
        input.cool_count,
        input.good_count,
        input.bad_count,
        input.miss_count,
    ];
    let judgments = counts.iter().try_fold(0_i64, |sum, value| {
        value.checked_add(sum).filter(|_| *value >= 0)
    });
    if !input.accuracy.is_finite()
        || !(0.0..=100.0).contains(&input.accuracy)
        || input.song_id < 0
        || input.score < 0
        || input.max_combo < 0
        || judgments.is_none_or(|total| input.max_combo > total)
    {
        return Err(ApiError::BadRequest("invalid score statistics".into()));
    }
    if input.outcome != "clear" && input.outcome != "failed" {
        return Err(ApiError::BadRequest(
            "outcome must be clear or failed".into(),
        ));
    }
    if (input.outcome == "clear") != (input.accuracy >= 60.0) {
        return Err(ApiError::BadRequest(
            "outcome does not match accuracy".into(),
        ));
    }
    Ok(())
}

fn timestamp_sql(kind: DatabaseKind, column: &str) -> String {
    match kind {
        DatabaseKind::MySql => {
            format!("DATE_FORMAT({column}, '%Y-%m-%dT%H:%i:%s.%fZ')")
        }
        DatabaseKind::Sqlite => format!("replace({column}, ' ', 'T') || 'Z'"),
    }
}

fn is_leaderboard_eligible(accuracy: f64) -> bool {
    accuracy >= 80.0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_outcome_and_counts() {
        let mut input = SubmitScore {
            submission_id: None,
            song_id: 1,
            score: 10,
            accuracy: 60.0,
            max_combo: 1,
            cool_count: 1,
            good_count: 0,
            bad_count: 0,
            miss_count: 0,
            outcome: "clear".into(),
        };
        assert!(validate(&input).is_ok());
        input.outcome = "failed".into();
        assert!(validate(&input).is_err());
        input.outcome = "clear".into();
        input.submission_id = Some("invalid id".into());
        assert!(validate(&input).is_err());
    }

    #[test]
    fn leaderboard_requires_eighty_percent() {
        assert!(!is_leaderboard_eligible(79.99));
        assert!(is_leaderboard_eligible(80.0));
        assert!(is_leaderboard_eligible(100.0));
    }

    #[tokio::test]
    async fn retrying_a_submission_does_not_insert_a_second_score() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = format!("target/meowcan-score-retry-{nonce}.db");
        let url = format!("sqlite://{path}?mode=rwc");
        let db = crate::database::Database::connect(&url, Some(2))
            .await
            .unwrap();
        db.migrate().await.unwrap();
        sqlx::query("INSERT INTO users (id, email, display_name, password_hash) VALUES (1, 'test@example.com', 'Test', 'unused')")
            .execute(&db.pool).await.unwrap();
        sqlx::query(
            "INSERT INTO songs (id, filename, title) VALUES (3434, '3434.vos', 'Test song')",
        )
        .execute(&db.pool)
        .await
        .unwrap();
        let state = AppState {
            db,
            session_hours: 24,
            cookie_secure: false,
        };
        let user = AuthUser {
            id: 1,
            email: "test@example.com".into(),
            display_name: "Test".into(),
            roles: vec!["player".into()],
            permissions: vec!["score:create".into()],
        };
        let input = || SubmitScore {
            submission_id: Some("same-play".into()),
            song_id: 3434,
            score: 100,
            accuracy: 90.0,
            max_combo: 1,
            cool_count: 1,
            good_count: 0,
            bad_count: 0,
            miss_count: 0,
            outcome: "clear".into(),
        };
        let Json(first) = submit(user.clone(), State(state.clone()), Json(input()))
            .await
            .unwrap();
        let Json(second) = submit(user, State(state.clone()), Json(input()))
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scores")
            .fetch_one(&state.db.pool)
            .await
            .unwrap();
        assert!(first.saved && second.saved);
        assert_eq!(count, 1);
        state.db.pool.close().await;
        drop(state);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{path}-shm"));
        let _ = std::fs::remove_file(format!("{path}-wal"));
    }
}
