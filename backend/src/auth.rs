use std::collections::BTreeSet;

use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Json,
    extract::{FromRef, FromRequestParts, State},
    http::{HeaderMap, HeaderValue, header, request::Parts},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Any, FromRow, Transaction};

use crate::{
    database::{Database, DatabaseKind},
    error::{ApiError, ApiResult},
    state::AppState,
};

const SESSION_COOKIE: &str = "meowcan_session";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
}

#[derive(FromRow)]
struct UserRow {
    id: i64,
    email: String,
    display_name: String,
}

impl AuthUser {
    pub fn require(&self, permission: &str) -> ApiResult<()> {
        self.permissions
            .iter()
            .any(|item| item == permission)
            .then_some(())
            .ok_or(ApiError::Forbidden)
    }
}

impl<S> FromRequestParts<S> for AuthUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = AppState::from_ref(state);
        let token = cookie_value(&parts.headers, SESSION_COOKIE).ok_or(ApiError::Unauthorized)?;
        load_user_by_token(&state, &token).await
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    email: String,
    display_name: String,
    password: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    user: AuthUser,
}

pub async fn register(
    State(state): State<AppState>,
    Json(input): Json<RegisterRequest>,
) -> ApiResult<(HeaderMap, Json<AuthResponse>)> {
    let email = normalize_email(&input.email)?;
    validate_display_name(&input.display_name)?;
    validate_password(&input.password)?;
    let password_hash = hash_password(input.password).await?;

    let _write_guard = state.db.write_guard().await;
    let mut tx = state.db.begin_write().await?;
    let result =
        sqlx::query("INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)")
            .bind(&email)
            .bind(input.display_name.trim())
            .bind(password_hash)
            .execute(&mut *tx)
            .await;
    let user_id = match result {
        Ok(result) => inserted_id(&mut tx, result.last_insert_id()).await?,
        Err(error) if is_duplicate(&error) => {
            return Err(ApiError::Conflict(
                "email or display name is already registered".into(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    sqlx::query(
        "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'player'",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    let token = create_session(&mut tx, state.db.kind, user_id, state.session_hours).await?;
    tx.commit().await?;
    drop(_write_guard);

    let user = load_user_by_token(&state, &token).await?;
    Ok((
        session_headers(&token, state.session_hours, state.cookie_secure)?,
        Json(AuthResponse { user }),
    ))
}

pub async fn login(
    State(state): State<AppState>,
    Json(input): Json<LoginRequest>,
) -> ApiResult<(HeaderMap, Json<AuthResponse>)> {
    let email = normalize_email(&input.email)?;
    #[derive(FromRow)]
    struct LoginRow {
        id: i64,
        password_hash: String,
        status: String,
    }
    let row = sqlx::query_as::<_, LoginRow>(
        "SELECT id, password_hash, status FROM users WHERE email = ?",
    )
    .bind(email)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or(ApiError::Unauthorized)?;
    if row.status != "active" || !verify_password(input.password, row.password_hash).await? {
        return Err(ApiError::Unauthorized);
    }
    let _write_guard = state.db.write_guard().await;
    let mut tx = state.db.begin_write().await?;
    let token = create_session(&mut tx, state.db.kind, row.id, state.session_hours).await?;
    tx.commit().await?;
    drop(_write_guard);
    let user = load_user_by_token(&state, &token).await?;
    Ok((
        session_headers(&token, state.session_hours, state.cookie_secure)?,
        Json(AuthResponse { user }),
    ))
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<HeaderMap> {
    if let Some(token) = cookie_value(&headers, SESSION_COOKIE) {
        let _write_guard = state.db.write_guard().await;
        sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
            .bind(token_hash(&token).to_vec())
            .execute(&state.db.pool)
            .await?;
    }
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_static("meowcan_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"),
    );
    Ok(response_headers)
}

pub async fn me(user: AuthUser) -> Json<AuthResponse> {
    Json(AuthResponse { user })
}

pub async fn create_admin(
    db: &Database,
    email: &str,
    display_name: &str,
    password: String,
) -> anyhow::Result<()> {
    let email = normalize_email(email).map_err(|error| anyhow::anyhow!(error.to_string()))?;
    validate_display_name(display_name).map_err(|error| anyhow::anyhow!(error.to_string()))?;
    validate_password(&password).map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let password_hash = hash_password(password)
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let _write_guard = db.write_guard().await;
    let mut tx = db.begin_write().await?;
    let upsert_sql = match db.kind {
        DatabaseKind::MySql => {
            "INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?) \
            ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), password_hash = VALUES(password_hash), status = 'active'"
        }
        DatabaseKind::Sqlite => {
            "INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?) \
            ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, password_hash = excluded.password_hash, status = 'active'"
        }
    };
    sqlx::query(upsert_sql)
        .bind(&email)
        .bind(display_name.trim())
        .bind(password_hash)
        .execute(&mut *tx)
        .await?;
    let user_id = sqlx::query_scalar::<_, i64>("SELECT id FROM users WHERE email = ?")
        .bind(&email)
        .fetch_one(&mut *tx)
        .await?;
    let delete_roles_sql = match db.kind {
        DatabaseKind::MySql => {
            "DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?"
        }
        DatabaseKind::Sqlite => "DELETE FROM user_roles WHERE user_id = ?",
    };
    sqlx::query(delete_roles_sql)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'admin'",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn load_user_by_token(state: &AppState, token: &str) -> ApiResult<AuthUser> {
    let hash = token_hash(token);
    let load_sql = format!(
        "SELECT u.id, u.email, u.display_name FROM sessions s \
         JOIN users u ON u.id = s.user_id \
         WHERE s.token_hash = ? AND s.expires_at > {} AND u.status = 'active'",
        state.db.now_expression()
    );
    let user = sqlx::query_as::<_, UserRow>(&load_sql)
        .bind(hash.to_vec())
        .fetch_optional(&state.db.pool)
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let roles = sqlx::query_scalar::<_, String>(
        "SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.name"
    ).bind(user.id).fetch_all(&state.db.pool).await?;
    let permissions = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT p.name FROM user_roles ur \
         JOIN role_permissions rp ON rp.role_id = ur.role_id \
         JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ? ORDER BY p.name",
    )
    .bind(user.id)
    .fetch_all(&state.db.pool)
    .await?;
    let _write_guard = state.db.write_guard().await;
    let touch_sql = match state.db.kind {
        DatabaseKind::MySql => {
            "UPDATE sessions SET last_seen_at = NOW(6) WHERE token_hash = ? AND last_seen_at < DATE_SUB(NOW(6), INTERVAL 5 MINUTE)"
        }
        DatabaseKind::Sqlite => {
            "UPDATE sessions SET last_seen_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE token_hash = ? AND last_seen_at < strftime('%Y-%m-%d %H:%M:%f', 'now', '-5 minutes')"
        }
    };
    sqlx::query(touch_sql)
        .bind(hash.to_vec())
        .execute(&state.db.pool)
        .await?;
    Ok(AuthUser {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        roles,
        permissions,
    })
}

async fn create_session(
    tx: &mut Transaction<'_, Any>,
    kind: DatabaseKind,
    user_id: i64,
    hours: i64,
) -> ApiResult<String> {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let sql = match kind {
        DatabaseKind::MySql => {
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(6), INTERVAL ? HOUR))"
        }
        DatabaseKind::Sqlite => {
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' hours'))"
        }
    };
    sqlx::query(sql)
        .bind(user_id)
        .bind(token_hash(&token).to_vec())
        .bind(hours)
        .execute(&mut **tx)
        .await?;
    Ok(token)
}

async fn inserted_id(
    tx: &mut Transaction<'_, Any>,
    driver_id: Option<i64>,
) -> Result<i64, sqlx::Error> {
    match driver_id.filter(|id| *id > 0) {
        Some(id) => Ok(id),
        None => {
            sqlx::query_scalar("SELECT last_insert_rowid()")
                .fetch_one(&mut **tx)
                .await
        }
    }
}

fn token_hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn session_headers(token: &str, hours: i64, secure: bool) -> ApiResult<HeaderMap> {
    let secure = if secure { "; Secure" } else { "" };
    let value = format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
        hours * 3600,
        secure
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&value).map_err(|error| ApiError::Internal(error.into()))?,
    );
    Ok(headers)
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            (key == name).then(|| value.to_owned())
        })
}

async fn hash_password(password: String) -> ApiResult<String> {
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|hash| hash.to_string())
            .map_err(|error| ApiError::Internal(anyhow::anyhow!(error)))
    })
    .await
    .map_err(|error| ApiError::Internal(error.into()))?
}

async fn verify_password(password: String, password_hash: String) -> ApiResult<bool> {
    tokio::task::spawn_blocking(move || {
        let parsed = PasswordHash::new(&password_hash)
            .map_err(|error| ApiError::Internal(anyhow::anyhow!(error)))?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    })
    .await
    .map_err(|error| ApiError::Internal(error.into()))?
}

fn normalize_email(value: &str) -> ApiResult<String> {
    let email = value.trim().to_lowercase();
    if email.len() > 254 || !email.contains('@') || email.starts_with('@') || email.ends_with('@') {
        return Err(ApiError::BadRequest("invalid email address".into()));
    }
    Ok(email)
}

fn validate_display_name(value: &str) -> ApiResult<()> {
    let count = value.trim().chars().count();
    if !(2..=32).contains(&count) || value.chars().any(char::is_control) {
        return Err(ApiError::BadRequest(
            "display name must contain 2 to 32 visible characters".into(),
        ));
    }
    Ok(())
}

fn validate_password(value: &str) -> ApiResult<()> {
    let categories = BTreeSet::from_iter(value.chars().filter_map(|ch| {
        if ch.is_ascii_lowercase() {
            Some(0)
        } else if ch.is_ascii_uppercase() {
            Some(1)
        } else if ch.is_ascii_digit() {
            Some(2)
        } else if ch.is_ascii_punctuation() {
            Some(3)
        } else {
            None
        }
    }));
    if value.len() < 10 || value.len() > 128 || categories.len() < 3 {
        return Err(ApiError::BadRequest("password must be 10-128 characters and use at least three of: lowercase, uppercase, numbers, symbols".into()));
    }
    Ok(())
}

fn is_duplicate(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(db) if db.is_unique_violation())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_policy_requires_three_categories() {
        assert!(validate_password("alllowercaseonly").is_err());
        assert!(validate_password("GoodPassword1").is_ok());
    }

    #[test]
    fn extracts_named_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("theme=pink; meowcan_session=abc123; a=b"),
        );
        assert_eq!(
            cookie_value(&headers, SESSION_COOKIE).as_deref(),
            Some("abc123")
        );
    }
}
