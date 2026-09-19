CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    display_name VARCHAR(32) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY users_email_unique (email),
    UNIQUE KEY users_display_name_unique (display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE roles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    description VARCHAR(255) NOT NULL,
    UNIQUE KEY roles_name_unique (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE permissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(96) NOT NULL,
    description VARCHAR(255) NOT NULL,
    UNIQUE KEY permissions_name_unique (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_roles (
    user_id BIGINT UNSIGNED NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT user_roles_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role_permissions (
    role_id BIGINT UNSIGNED NOT NULL,
    permission_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT role_permissions_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT role_permissions_permission_fk FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash BINARY(32) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY sessions_token_hash_unique (token_hash),
    KEY sessions_user_id_idx (user_id),
    KEY sessions_expires_at_idx (expires_at),
    CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE songs (
    id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    genre VARCHAR(64) NOT NULL DEFAULT '',
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL DEFAULT '',
    charter VARCHAR(255) NOT NULL DEFAULT '',
    level SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    duration_sec INT UNSIGNED NOT NULL DEFAULT 0,
    notes INT UNSIGNED NOT NULL DEFAULT 0,
    popularity BIGINT UNSIGNED NOT NULL DEFAULT 0,
    format VARCHAR(32) NULL,
    UNIQUE KEY songs_filename_unique (filename),
    KEY songs_level_idx (level),
    KEY songs_genre_idx (genre),
    KEY songs_popularity_idx (popularity),
    FULLTEXT KEY songs_search_ft (title, artist, charter)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE scores (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    song_id BIGINT UNSIGNED NOT NULL,
    score BIGINT UNSIGNED NOT NULL,
    accuracy DECIMAL(5,2) UNSIGNED NOT NULL,
    max_combo INT UNSIGNED NOT NULL,
    cool_count INT UNSIGNED NOT NULL,
    good_count INT UNSIGNED NOT NULL,
    bad_count INT UNSIGNED NOT NULL,
    miss_count INT UNSIGNED NOT NULL,
    outcome ENUM('clear', 'failed') NOT NULL,
    played_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY scores_user_song_rank_idx (user_id, song_id, score DESC, accuracy DESC, played_at ASC),
    CONSTRAINT scores_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT scores_song_fk FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO roles (name, description) VALUES
    ('player', 'Can submit and view their own scores'),
    ('moderator', 'Can review users and all scores'),
    ('admin', 'Can administer users, roles, and all scores');

INSERT INTO permissions (name, description) VALUES
    ('score:create', 'Submit a play result'),
    ('score:read:self', 'Read own play results'),
    ('score:read:any', 'Read every player result'),
    ('user:read', 'Read user accounts'),
    ('user:disable', 'Enable or disable a user account'),
    ('role:read', 'Read roles and permission grants'),
    ('role:assign', 'Assign roles to users');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE (r.name = 'player' AND p.name IN ('score:create', 'score:read:self'))
   OR (r.name = 'moderator' AND p.name IN ('score:read:any', 'user:read', 'role:read'))
   OR (r.name = 'admin');

