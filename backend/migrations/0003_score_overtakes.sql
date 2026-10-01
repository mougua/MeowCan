ALTER TABLE scores ADD KEY scores_song_rank_idx (song_id, score DESC, accuracy DESC, max_combo DESC, played_at ASC);

CREATE TABLE score_overtakes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    challenger_id BIGINT UNSIGNED NOT NULL,
    song_id BIGINT UNSIGNED NOT NULL,
    previous_score BIGINT UNSIGNED NOT NULL,
    new_score BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    seen_at DATETIME(6) NULL,
    KEY score_overtakes_unseen_idx (user_id, seen_at, id),
    CONSTRAINT score_overtakes_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT score_overtakes_challenger_fk FOREIGN KEY (challenger_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT score_overtakes_song_fk FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
