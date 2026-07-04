<?php
// Add BOTH cases to the switch($action) block in api.php
// -------------------------------------------------------

// 1) Save a snapshot (called by server.js on every round/year/phase milestone)
case 'saveGameSnapshot':
    $stmt = $conn->prepare("INSERT INTO game_state_snapshots
        (game_code, game_id, snapshot_type, phase, round_or_year,
         players, scores, round_history, current_round, current_year,
         yearly_data, policies, deployments, deployment_history,
         crises, battle_results, diplomatic_points, full_state, player_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    $stmt->bind_param("sisissssiissssssssi",
        $data['game_code'],
        $data['game_id'],
        $data['snapshot_type'],
        $data['phase'],
        $data['round_or_year'],
        $data['players'],
        $data['scores'],
        $data['round_history'],
        $data['current_round'],
        $data['current_year'],
        $data['yearly_data'],
        $data['policies'],
        $data['deployments'],
        $data['deployment_history'],
        $data['crises'],
        $data['battle_results'],
        $data['diplomatic_points'],
        $data['full_state'],
        $data['player_count']
    );

    if ($stmt->execute()) {
        echo json_encode(['success' => true, 'data' => ['id' => $conn->insert_id]]);
    } else {
        echo json_encode(['success' => false, 'error' => $stmt->error]);
    }
    $stmt->close();
    break;

// 2) Get the latest snapshot for a game (called on server startup to restore state)
case 'getLatestSnapshot':
    $stmt = $conn->prepare("SELECT * FROM game_state_snapshots
        WHERE game_code = ?
        ORDER BY id DESC
        LIMIT 1");

    $stmt->bind_param("s", $data['game_code']);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    if ($row) {
        echo json_encode(['success' => true, 'data' => $row]);
    } else {
        echo json_encode(['success' => true, 'data' => null]);
    }
    break;
?>
