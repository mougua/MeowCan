CREATE INDEX scores_song_rank_idx ON scores(song_id, score DESC, accuracy DESC, max_combo DESC, played_at ASC);

CREATE TABLE score_overtakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    previous_score INTEGER NOT NULL,
    new_score INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    seen_at TEXT
);
CREATE INDEX score_overtakes_unseen_idx ON score_overtakes(user_id, seen_at, id);
