use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{
    auth::AuthUser,
    error::{ApiError, ApiResult},
    state::AppState,
};

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    id: u64,
    email: String,
    display_name: String,
    status: String,
    roles: Option<String>,
}

#[derive(FromRow, Serialize)]
pub struct RoleSummary {
    id: u64,
    name: String,
    description: String,
    permissions: Option<String>,
}

#[derive(Deserialize)]
pub struct AssignRoles {
    roles: Vec<String>,
}

#[derive(Deserialize)]
pub struct ChangeStatus {
    status: String,
}

#[derive(Deserialize)]
pub struct ScoreFilter {
    user_id: Option<u64>,
    song_id: Option<u64>,
    limit: Option<u32>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreSummary {
    id: u64,
    user_id: u64,
    display_name: String,
    song_id: u64,
    score: u64,
    accuracy: f64,
    max_combo: u32,
    outcome: String,
    played_at: String,
}

pub async fn users(
    user: AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<UserSummary>>> {
    user.require("user:read")?;
    let rows = sqlx::query_as::<_, UserSummary>(
        "SELECT u.id, u.email, u.display_name, u.status, GROUP_CONCAT(r.name ORDER BY r.name) roles \
         FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id \
         GROUP BY u.id ORDER BY u.id"
    ).fetch_all(&state.pool).await?;
    Ok(Json(rows))
}

pub async fn roles(
    user: AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<RoleSummary>>> {
    user.require("role:read")?;
    let rows = sqlx::query_as::<_, RoleSummary>(
        "SELECT r.id, r.name, r.description, GROUP_CONCAT(p.name ORDER BY p.name) permissions FROM roles r \
         LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id \
         GROUP BY r.id ORDER BY r.id"
    ).fetch_all(&state.pool).await?;
    Ok(Json(rows))
}

pub async fn scores(
    user: AuthUser,
    State(state): State<AppState>,
    Query(filter): Query<ScoreFilter>,
) -> ApiResult<Json<Vec<ScoreSummary>>> {
    user.require("score:read:any")?;
    let limit = filter.limit.unwrap_or(100).clamp(1, 500);
    let rows = sqlx::query_as::<_, ScoreSummary>(
        "SELECT s.id, s.user_id, u.display_name, s.song_id, s.score, CAST(s.accuracy AS DOUBLE) accuracy, \
         s.max_combo, s.outcome, DATE_FORMAT(s.played_at, '%Y-%m-%dT%H:%i:%s.%fZ') played_at \
         FROM scores s JOIN users u ON u.id = s.user_id \
         WHERE (? IS NULL OR s.user_id = ?) AND (? IS NULL OR s.song_id = ?) \
         ORDER BY s.played_at DESC LIMIT ?",
    )
    .bind(filter.user_id)
    .bind(filter.user_id)
    .bind(filter.song_id)
    .bind(filter.song_id)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn assign_roles(
    user: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<u64>,
    Json(input): Json<AssignRoles>,
) -> ApiResult<()> {
    user.require("role:assign")?;
    if user.id == user_id && !input.roles.iter().any(|role| role == "admin") {
        return Err(ApiError::BadRequest(
            "administrators cannot remove their own admin role".into(),
        ));
    }
    let mut roles = input.roles;
    roles.sort();
    roles.dedup();
    if roles.is_empty() {
        return Err(ApiError::BadRequest("at least one role is required".into()));
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT id FROM roles WHERE name = 'admin' FOR UPDATE")
        .fetch_one(&mut *tx)
        .await?;
    let valid = sqlx::query_scalar::<_, String>("SELECT name FROM roles")
        .fetch_all(&mut *tx)
        .await?;
    if roles.iter().any(|role| !valid.contains(role)) {
        return Err(ApiError::BadRequest("unknown role".into()));
    }
    let exists = sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM users WHERE id = ?)")
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?
        != 0;
    if !exists {
        return Err(ApiError::NotFound);
    }
    let target_is_admin = sqlx::query_scalar::<_, i64>(
        "SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = 'admin')",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?
        != 0;
    if target_is_admin && !roles.iter().any(|role| role == "admin") {
        let active_admins = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(DISTINCT u.id) FROM users u JOIN user_roles ur ON ur.user_id = u.id \
             JOIN roles r ON r.id = ur.role_id WHERE u.status = 'active' AND r.name = 'admin'",
        )
        .fetch_one(&mut *tx)
        .await?;
        if active_admins <= 1 {
            return Err(ApiError::BadRequest(
                "the last active administrator cannot lose the admin role".into(),
            ));
        }
    }
    sqlx::query("DELETE FROM user_roles WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    for role in roles {
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = ?",
        )
        .bind(user_id)
        .bind(role)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn change_status(
    user: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<u64>,
    Json(input): Json<ChangeStatus>,
) -> ApiResult<()> {
    user.require("user:disable")?;
    if input.status != "active" && input.status != "disabled" {
        return Err(ApiError::BadRequest("invalid status".into()));
    }
    if user.id == user_id && input.status == "disabled" {
        return Err(ApiError::BadRequest(
            "administrators cannot disable themselves".into(),
        ));
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT id FROM roles WHERE name = 'admin' FOR UPDATE")
        .fetch_one(&mut *tx)
        .await?;
    if input.status == "disabled" {
        let is_admin = sqlx::query_scalar::<_, i64>(
            "SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = 'admin')",
        )
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?
            != 0;
        if is_admin {
            let active_admins = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(DISTINCT u.id) FROM users u JOIN user_roles ur ON ur.user_id = u.id \
                 JOIN roles r ON r.id = ur.role_id WHERE u.status = 'active' AND r.name = 'admin'",
            )
            .fetch_one(&mut *tx)
            .await?;
            if active_admins <= 1 {
                return Err(ApiError::BadRequest(
                    "the last active administrator cannot be disabled".into(),
                ));
            }
        }
    }
    let result = sqlx::query("UPDATE users SET status = ? WHERE id = ?")
        .bind(&input.status)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    if input.status == "disabled" {
        sqlx::query("DELETE FROM sessions WHERE user_id = ?")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}
