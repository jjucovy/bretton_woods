-- Crisis Options table
-- Stores player choices for crisis events during Phase 2
-- Run this on Hostinger MySQL to create the table

CREATE TABLE IF NOT EXISTS crisis_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_id INT NOT NULL,
    game_code VARCHAR(64) NOT NULL,
    crisis_id VARCHAR(64) NOT NULL COMMENT 'e.g. china-civil-war, berlin-blockade',
    crisis_title VARCHAR(255) NOT NULL,
    crisis_year INT NOT NULL COMMENT 'Year the crisis occurs (1946-1952)',
    player_id VARCHAR(128) NOT NULL COMMENT 'User/player ID who made the choice',
    country VARCHAR(64) NOT NULL COMMENT 'Country making the choice',
    choice_id VARCHAR(64) NOT NULL COMMENT 'Option ID chosen (e.g. massive-aid, disengage)',
    choice_text TEXT NOT NULL COMMENT 'Display text of chosen option',
    choice_effects JSON DEFAULT NULL COMMENT 'Economic effects applied',
    cross_effects JSON DEFAULT NULL COMMENT 'Effects on other countries',
    outcome_text TEXT DEFAULT NULL COMMENT 'Outcome description shown to player',
    cost INT DEFAULT 0 COMMENT 'Gold/resource cost of the choice',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_game_crisis (game_id, crisis_id),
    INDEX idx_game_code (game_code),
    INDEX idx_player (player_id),
    INDEX idx_year (crisis_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API handlers to add to api.php on Hostinger (uses $conn and query()/respond() helpers):
--
-- case 'saveCrisisChoice':
--     $result = query($conn, "INSERT INTO crisis_options
--         (game_id, game_code, crisis_id, crisis_title, crisis_year,
--          player_id, country, choice_id, choice_text,
--          choice_effects, cross_effects, outcome_text, cost)
--         VALUES (
--             " . intval($data['game_id']) . ",
--             '" . mysqli_real_escape_string($conn, $data['game_code']) . "',
--             '" . mysqli_real_escape_string($conn, $data['crisis_id']) . "',
--             '" . mysqli_real_escape_string($conn, $data['crisis_title']) . "',
--             " . intval($data['crisis_year']) . ",
--             '" . mysqli_real_escape_string($conn, $data['player_id']) . "',
--             '" . mysqli_real_escape_string($conn, $data['country']) . "',
--             '" . mysqli_real_escape_string($conn, $data['choice_id']) . "',
--             '" . mysqli_real_escape_string($conn, $data['choice_text']) . "',
--             '" . mysqli_real_escape_string($conn, json_encode($data['choice_effects'] ?? null)) . "',
--             '" . mysqli_real_escape_string($conn, json_encode($data['cross_effects'] ?? null)) . "',
--             '" . mysqli_real_escape_string($conn, $data['outcome_text'] ?? '') . "',
--             " . intval($data['cost'] ?? 0) . ")");
--     respond(['success' => true, 'id' => mysqli_insert_id($conn)]);
--     break;
--
-- case 'getCrisisChoices':
--     $where = "game_id = " . intval($data['game_id']);
--     if (!empty($data['crisis_id'])) {
--         $where .= " AND crisis_id = '" . mysqli_real_escape_string($conn, $data['crisis_id']) . "'";
--     }
--     if (!empty($data['crisis_year'])) {
--         $where .= " AND crisis_year = " . intval($data['crisis_year']);
--     }
--     $result = query($conn, "SELECT * FROM crisis_options WHERE $where ORDER BY created_at");
--     respond($result ?: []);
--     break;
