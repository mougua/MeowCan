CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (email),
    UNIQUE (display_name)
);

CREATE TRIGGER users_set_updated_at
AFTER UPDATE ON users
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE users
    SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
    WHERE id = NEW.id;
END;

CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL
);

CREATE TABLE permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL
);

CREATE TABLE user_roles (
    user_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE role_permissions (
    role_id INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash BLOB NOT NULL UNIQUE CHECK (length(token_hash) = 32),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE songs (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    genre TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    charter TEXT NOT NULL DEFAULT '',
    level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
    duration_sec INTEGER NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
    notes INTEGER NOT NULL DEFAULT 0 CHECK (notes >= 0),
    popularity INTEGER NOT NULL DEFAULT 0 CHECK (popularity >= 0),
    format TEXT
);
CREATE INDEX songs_level_idx ON songs(level);
CREATE INDEX songs_genre_idx ON songs(genre);
CREATE INDEX songs_popularity_idx ON songs(popularity);

CREATE TABLE scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0),
    accuracy REAL NOT NULL CHECK (accuracy >= 0 AND accuracy <= 100),
    max_combo INTEGER NOT NULL CHECK (max_combo >= 0),
    cool_count INTEGER NOT NULL CHECK (cool_count >= 0),
    good_count INTEGER NOT NULL CHECK (good_count >= 0),
    bad_count INTEGER NOT NULL CHECK (bad_count >= 0),
    miss_count INTEGER NOT NULL CHECK (miss_count >= 0),
    outcome TEXT NOT NULL CHECK (outcome IN ('clear', 'failed')),
    played_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);
CREATE INDEX scores_user_song_rank_idx
ON scores(user_id, song_id, score DESC, accuracy DESC, played_at ASC);

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
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE (r.name = 'player' AND p.name IN ('score:create', 'score:read:self'))
   OR (r.name = 'moderator' AND p.name IN ('score:read:any', 'user:read', 'role:read'))
   OR (r.name = 'admin');
