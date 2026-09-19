use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitScore {
    song_id: u64,
    score: u64,
    accuracy: f64,
    max_combo: u32,
    cool_count: u32,
    good_count: u32,
    bad_count: u32,
    miss_count: u32,
    outcome: String,
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    id: u64,
    song_id: u64,
    score: u64,
    accuracy: f64,
    max_combo: u32,
    cool_count: u32,
    good_count: u32,
    bad_count: u32,
    miss_count: u32,
    outcome: String,
    played_at: String,
}

#[derive(Deserialize)]
pub struct ScoreQuery {
    song_id: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitResponse {
    saved: bool,
    top_scores: Vec<Score>,
}

pub async fn submit(
    user: AuthUser,
    State(state): State<AppState>,
    Json(input): Json<SubmitScore>,
) -> ApiResult<Json<SubmitResponse>> {
    user.require("score:create")?;
    validate(&input)?;
    let mut tx = state.pool.begin().await?;
    // Serialize submissions per player so concurrent finishes cannot leave more than five rows.
    sqlx::query("SELECT id FROM users WHERE id = ? FOR UPDATE")
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await?;
    let exists = sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM songs WHERE id = ?)")
        .bind(input.song_id)
        .fetch_one(&mut *tx)
        .await?
        != 0;
    if !exists {
        return Err(ApiError::NotFound);
    }
    let result = sqlx::query(
        "INSERT INTO scores (user_id, song_id, score, accuracy, max_combo, cool_count, good_count, bad_count, miss_count, outcome) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(user.id).bind(input.song_id).bind(input.score).bind(input.accuracy).bind(input.max_combo)
        .bind(input.cool_count).bind(input.good_count).bind(input.bad_count).bind(input.miss_count)
        .bind(&input.outcome).execute(&mut *tx).await?;
    let inserted_id = result.last_insert_id();

    sqlx::query(
        "DELETE FROM scores WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER \
         (ORDER BY score DESC, accuracy DESC, max_combo DESC, played_at ASC, id ASC) AS position \
         FROM scores WHERE user_id = ? AND song_id = ?) ranked WHERE position > 5)",
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
    let top_scores = fetch_top(&mut *tx, user.id, Some(input.song_id)).await?;
    tx.commit().await?;
    Ok(Json(SubmitResponse { saved, top_scores }))
}

pub async fn mine(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<ScoreQuery>,
) -> ApiResult<Json<Vec<Score>>> {
    user.require("score:read:self")?;
    Ok(Json(fetch_top(&state.pool, user.id, query.song_id).await?))
}

async fn fetch_top<'e, E>(
    executor: E,
    user_id: u64,
    song_id: Option<u64>,
) -> Result<Vec<Score>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::MySql>,
{
    sqlx::query_as::<_, Score>(
        "SELECT id, song_id, score, CAST(accuracy AS DOUBLE) accuracy, max_combo, cool_count, good_count, bad_count, miss_count, \
         outcome, DATE_FORMAT(played_at, '%Y-%m-%dT%H:%i:%s.%fZ') played_at FROM scores \
         WHERE user_id = ? AND (? IS NULL OR song_id = ?) \
         ORDER BY song_id ASC, score DESC, accuracy DESC, max_combo DESC, played_at ASC LIMIT 500"
    ).bind(user_id).bind(song_id).bind(song_id).fetch_all(executor).await
}

fn validate(input: &SubmitScore) -> ApiResult<()> {
    let judgments = u64::from(input.cool_count)
        + u64::from(input.good_count)
        + u64::from(input.bad_count)
        + u64::from(input.miss_count);
    if !input.accuracy.is_finite()
        || !(0.0..=100.0).contains(&input.accuracy)
        || input.max_combo as u64 > judgments
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_outcome_and_counts() {
        let mut input = SubmitScore {
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
    }
}
