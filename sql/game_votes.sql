-- Game Votes table
-- Stores individual player votes per round
-- Run this on Hostinger MySQL to create the table

CREATE TABLE IF NOT EXISTS game_votes (
    vote_id INT AUTO_INCREMENT PRIMARY KEY,
    game_id INT NOT NULL,
    player_id INT NOT NULL,
    round_number INT NOT NULL,
    issue_id INT NOT NULL,
    issue_title VARCHAR(255) NOT NULL,
    option_id VARCHAR(1) NOT NULL COMMENT 'a, b, c, or d',
    option_text TEXT NOT NULL,
    points_earned INT NOT NULL DEFAULT 0,
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_game_round (game_id, round_number),
    INDEX idx_player (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API handler to add to api.php on Hostinger (uses $conn and query()/respond() helpers):
--
-- case 'saveGameVote':
--     $result = query($conn, "INSERT INTO game_votes
--         (game_id, player_id, round_number, issue_id, issue_title, option_id, option_text, points_earned)
--         VALUES (
--             " . intval($data['game_id']) . ",
--             " . intval($data['player_id']) . ",
--             " . intval($data['round_number']) . ",
--             " . intval($data['issue_id']) . ",
--             '" . mysqli_real_escape_string($conn, $data['issue_title']) . "',
--             '" . mysqli_real_escape_string($conn, $data['option_id']) . "',
--             '" . mysqli_real_escape_string($conn, $data['option_text']) . "',
--             " . intval($data['points_earned']) . ")");
--     respond(['success' => true, 'vote_id' => mysqli_insert_id($conn)]);
--     break;
--
-- case 'getGameVotes':
--     $result = query($conn, "SELECT * FROM game_votes
--         WHERE game_id = " . intval($data['game_id']) . "
--         ORDER BY round_number, player_id");
--     respond($result ?: []);
--     break;
