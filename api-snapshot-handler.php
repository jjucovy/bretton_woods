<?php
// Add this case to the switch($action) block in api.php
// Handles the 'saveGameSnapshot' action from server.js

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
?>
