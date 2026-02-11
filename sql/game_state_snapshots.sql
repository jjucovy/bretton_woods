-- Game State Snapshots table
-- Stores complete game state at end of each round (Phase 1) or year (Phase 2)
-- Run this on Hostinger MySQL to create the table

CREATE TABLE IF NOT EXISTS game_state_snapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_code VARCHAR(64) NOT NULL,
    game_id INT DEFAULT NULL,
    snapshot_type ENUM('round_end', 'year_end', 'phase_transition', 'game_complete') NOT NULL,
    phase TINYINT NOT NULL COMMENT '1 = Phase 1 voting, 2 = Phase 2 economics',
    round_or_year INT NOT NULL COMMENT 'Round number (1-10) or Year (1946-1952)',

    -- Player state
    players JSON NOT NULL COMMENT 'All players with countries, scores',
    scores JSON NOT NULL COMMENT 'Score breakdown by country',

    -- Phase 1 data
    round_history JSON DEFAULT NULL COMMENT 'Voting history up to this point',
    current_round INT DEFAULT NULL,

    -- Phase 2 data (null during Phase 1)
    current_year INT DEFAULT NULL,
    yearly_data JSON DEFAULT NULL COMMENT 'Economic data for all years so far',
    policies JSON DEFAULT NULL COMMENT 'All policies submitted by year',
    deployments JSON DEFAULT NULL COMMENT 'Cumulative troop deployments',
    deployment_history JSON DEFAULT NULL COMMENT 'Deployment log',
    crises JSON DEFAULT NULL COMMENT 'Crisis state and history',
    battle_results JSON DEFAULT NULL COMMENT 'Battle outcomes',
    diplomatic_points JSON DEFAULT NULL COMMENT 'Diplomatic scores',

    -- Full state backup (compressed)
    full_state LONGTEXT DEFAULT NULL COMMENT 'Complete JSON state for full restoration',

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    player_count INT DEFAULT 0,

    INDEX idx_game_code (game_code),
    INDEX idx_game_phase (game_code, phase, round_or_year),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API handler to add to api.php on Hostinger:
--
-- case 'saveGameStateSnapshot':
--     $stmt = $pdo->prepare("INSERT INTO game_state_snapshots
--         (game_code, game_id, snapshot_type, phase, round_or_year,
--          players, scores, round_history, current_round,
--          current_year, yearly_data, policies, deployments,
--          deployment_history, crises, battle_results, diplomatic_points,
--          full_state, player_count)
--         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
--     $stmt->execute([
--         $data['game_code'],
--         $data['game_id'] ?? null,
--         $data['snapshot_type'],
--         $data['phase'],
--         $data['round_or_year'],
--         json_encode($data['players'] ?? []),
--         json_encode($data['scores'] ?? []),
--         json_encode($data['round_history'] ?? null),
--         $data['current_round'] ?? null,
--         $data['current_year'] ?? null,
--         json_encode($data['yearly_data'] ?? null),
--         json_encode($data['policies'] ?? null),
--         json_encode($data['deployments'] ?? null),
--         json_encode($data['deployment_history'] ?? null),
--         json_encode($data['crises'] ?? null),
--         json_encode($data['battle_results'] ?? null),
--         json_encode($data['diplomatic_points'] ?? null),
--         $data['full_state'] ?? null,
--         $data['player_count'] ?? 0
--     ]);
--     echo json_encode(['success' => true, 'data' => ['id' => $pdo->lastInsertId()]]);
--     break;
--
-- case 'getGameStateSnapshots':
--     $stmt = $pdo->prepare("SELECT id, game_code, snapshot_type, phase, round_or_year,
--         players, scores, current_round, current_year, player_count, created_at
--         FROM game_state_snapshots
--         WHERE game_code = ?
--         ORDER BY created_at DESC");
--     $stmt->execute([$data['game_code']]);
--     $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
--     echo json_encode(['success' => true, 'data' => $rows]);
--     break;
--
-- case 'getGameStateSnapshot':
--     $stmt = $pdo->prepare("SELECT * FROM game_state_snapshots WHERE id = ?");
--     $stmt->execute([$data['id']]);
--     $row = $stmt->fetch(PDO::FETCH_ASSOC);
--     if ($row) {
--         echo json_encode(['success' => true, 'data' => $row]);
--     } else {
--         echo json_encode(['success' => false, 'error' => 'Snapshot not found']);
--     }
--     break;
