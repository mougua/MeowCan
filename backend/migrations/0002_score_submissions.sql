CREATE TABLE score_submissions (
    user_id BIGINT UNSIGNED NOT NULL,
    submission_id VARCHAR(64) NOT NULL,
    song_id BIGINT UNSIGNED NOT NULL,
    saved BOOLEAN NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, submission_id),
    CONSTRAINT score_submissions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT score_submissions_song_fk FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
