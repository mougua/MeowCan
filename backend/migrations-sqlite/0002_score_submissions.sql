CREATE TABLE score_submissions (
    user_id INTEGER NOT NULL,
    submission_id TEXT NOT NULL,
    song_id INTEGER NOT NULL,
    saved INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (user_id, submission_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);
