import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRoom, deleteRoom, listRooms, updateRoom } from '../db/rooms.js';
import { createMatchDistribution } from './match-distribution.js';
import { isMovementDirection, movePosition } from './player-movement.js';
import {
    connectPlayer,
    createPresenceRoom,
    deletePresenceRoom,
    disconnectPlayer,
    getPlayerViewers,
    getRoomPresence,
    joinRoomPresence,
    leaveRoomPresence,
    setPlayerSpectating,
    setSpectatorTarget
} from './presence.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLASSIC_DOOR_WAIT_MS = 5000;
const SESSION_FIELDS = new Set(['protocol_version', 'user_id', 'nickname', 'character_id']);
const ROOM_CREATE_FIELDS = new Set([
    'name',
    'mode',
    'floors',
    'notebooks_per_floor',
    'time_limit_seconds',
    'max_players'
]);
const ROOM_CONFIGURE_FIELDS = new Set(ROOM_CREATE_FIELDS);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyFields(value, allowedFields) {
    return Object.keys(value).every(field => allowedFields.has(field));
}

function send(socket, type, payload, requestId) {
    if (socket.readyState !== WebSocket.OPEN) return;

    const message = { type, payload };
    if (requestId !== undefined) message.request_id = requestId;
    socket.send(JSON.stringify(message));
}

function sendError(socket, code, message, requestId, retryable = false) {
    send(socket, 'error', { code, message, retryable }, requestId);
}

function roomSnapshot(database, presence, roomId) {
    const room = listRooms(database).find(candidate => candidate.id === roomId);
    if (!room) return null;

    const currentPresence = getRoomPresence(presence, roomId);
    return {
        revision: currentPresence.revision,
        room: {
            room_id: room.id,
            name: room.name,
            owner_id: room.owner_id,
            mode: room.mode,
            floors: room.floors,
            notebooks_per_floor: room.notebooks_per_floor,
            time_limit_seconds: room.time_limit_seconds,
            max_players: room.max_players,
            status: room.status
        },
        participants: currentPresence.players.map(player => ({
            user_id: player.userId,
            nickname: player.nickname,
            character_id: player.characterId,
            role: 'player',
            connected: player.connected
        }))
    };
}

function broadcastRoomSnapshot(server, database, presence, roomId, requester, requestId) {
    const snapshot = roomSnapshot(database, presence, roomId);
    if (!snapshot) return;

    for (const participant of snapshot.participants) {
        const connection = presence.connections.get(participant.user_id);
        if (connection) {
            send(
                connection,
                'room.snapshot',
                snapshot,
                connection === requester ? requestId : undefined
            );
        }
    }
}

function findRoomOwnerCandidate(presence, roomId, departingUserId, connectedOnly) {
    return getRoomPresence(presence, roomId).players.find(
        player => player.userId !== departingUserId && (!connectedOnly || player.connected)
    );
}

function transferRoomOwner(database, presence, room, departingUserId, connectedOnly) {
    if (!room || room.owner_id !== departingUserId) return false;

    const candidate = findRoomOwnerCandidate(presence, room.id, departingUserId, connectedOnly);
    if (!candidate) return false;

    updateRoom(database, room.id, { owner_id: candidate.userId });
    presence.rooms.get(room.id).revision += 1;
    return true;
}

function buildRankingEntries(roomId, presence) {
    const match = presence.rooms.get(roomId)?.match;
    if (!match) return [];

    const players = getRoomPresence(presence, roomId).players;
    const eliminationOrder = new Map(
        match.eliminationOrder.map((userId, index) => [userId, index])
    );
    players.sort((left, right) => {
        const leftProgress = match.progress.get(left.userId);
        const rightProgress = match.progress.get(right.userId);

        if (match.mode === 'classic') {
            const floorDifference = rightProgress.floor - leftProgress.floor;
            if (floorDifference) return floorDifference;

            if (leftProgress.status === 'finished' && rightProgress.status === 'finished') {
                const finishDifference = leftProgress.finishedAt - rightProgress.finishedAt;
                if (finishDifference) return finishDifference;
                const finishOrderDifference =
                    leftProgress.finishedOrder - rightProgress.finishedOrder;
                if (finishOrderDifference) return finishOrderDifference;
            } else {
                const arrivalOrderDifference =
                    leftProgress.floorReachedOrder - rightProgress.floorReachedOrder;
                if (arrivalOrderDifference) return arrivalOrderDifference;
            }
            return left.entryOrder - right.entryOrder;
        }

        if (left.userId === match.winnerUserId) return -1;
        if (right.userId === match.winnerUserId) return 1;
        const leftActive = left.status === 'active';
        const rightActive = right.status === 'active';
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        if (!leftActive && !rightActive) {
            const survivalDifference =
                (eliminationOrder.get(right.userId) ?? -1) -
                (eliminationOrder.get(left.userId) ?? -1);
            if (survivalDifference) return survivalDifference;
        }

        const floorDifference = rightProgress.floor - leftProgress.floor;
        if (floorDifference) return floorDifference;
        const arrivalOrderDifference =
            leftProgress.floorReachedOrder - rightProgress.floorReachedOrder;
        if (arrivalOrderDifference) return arrivalOrderDifference;
        return left.entryOrder - right.entryOrder;
    });

    return players.map((player, index) => {
        const progress = match.progress.get(player.userId);
        const status =
            player.userId === match.winnerUserId || progress.status === 'finished'
                ? 'finished'
                : match.mode === 'deathmatch' && player.status !== 'active'
                  ? 'eliminated'
                  : 'playing';
        return {
            rank: index + 1,
            user_id: player.userId,
            nickname: player.nickname,
            floor: Math.min(progress.floor, match.floors.length),
            status
        };
    });
}

function broadcastRanking(roomId, presence) {
    const roomPresence = presence.rooms.get(roomId);
    const match = roomPresence?.match;
    if (!match) return [];

    match.rankingRevision += 1;
    const entries = buildRankingEntries(roomId, presence);
    const message = { revision: match.rankingRevision, entries };
    for (const player of getRoomPresence(presence, roomId).players) {
        const connection = presence.connections.get(player.userId);
        if (connection) send(connection, 'ranking.updated', message);
    }
    return entries;
}

function recordFloorArrival(match, progress, now) {
    match.progressionRevision += 1;
    progress.floorReachedAt = now;
    progress.floorReachedOrder = match.progressionRevision;
}

function markPlayerFinished(match, progress, now) {
    match.progressionRevision += 1;
    progress.status = 'finished';
    progress.finishedAt = now;
    progress.finishedOrder = match.progressionRevision;
}

function finishMatch({ roomId, presence, winnerUserId = null, reason }) {
    const roomPresence = presence.rooms.get(roomId);
    const match = roomPresence?.match;
    if (!match || match.ended) return false;

    match.ended = true;
    match.endReason = reason;
    match.winnerUserId = winnerUserId;
    if (match.timeoutTimer !== null) {
        presence.clearTimeoutFn(match.timeoutTimer);
        match.timeoutTimer = null;
    }
    for (const progress of match.progress.values()) {
        if (progress.doorTimer !== null) {
            presence.clearTimeoutFn(progress.doorTimer);
            progress.doorTimer = null;
        }
    }
    const winnerProgress = match.progress.get(winnerUserId);
    if (winnerProgress) winnerProgress.status = 'finished';

    const entries = broadcastRanking(roomId, presence);

    for (const player of getRoomPresence(presence, roomId).players) {
        const connection = presence.connections.get(player.userId);
        if (connection) send(connection, 'match.ended', { reason, entries });
    }
    return true;
}

function scheduleMatchTimeout(match, roomId, presence) {
    if (match.deadline === null || match.ended) return;

    const remainingMs = match.deadline - presence.nowFn();
    match.timeoutTimer = presence.setTimeoutFn(
        () => {
            match.timeoutTimer = null;
            if (presence.rooms.get(roomId)?.match !== match || match.ended) return;
            if (presence.nowFn() < match.deadline) {
                scheduleMatchTimeout(match, roomId, presence);
                return;
            }
            finishMatch({ roomId, presence, reason: 'time_limit_reached' });
        },
        Math.max(0, remainingMs)
    );
    match.timeoutTimer.unref?.();
}

function expireMatchIfPastDeadline(match, roomId, presence) {
    if (!match || match.ended) return true;
    if (match.deadline === null || presence.nowFn() < match.deadline) return false;

    finishMatch({ roomId, presence, reason: 'time_limit_reached' });
    return true;
}

function finishClassicIfReady(match, roomId, presence) {
    const roomPresence = presence.rooms.get(roomId);
    if (
        match.mode === 'classic' &&
        roomPresence &&
        [...roomPresence.playerIds].every(
            userId => match.progress.get(userId)?.status === 'finished'
        )
    ) {
        finishMatch({ roomId, presence, reason: 'all_players_finished' });
    }
}

function removeRoomParticipant(database, presence, roomId, userId, connectedOnlyForHandoff) {
    const roomPresence = presence.rooms.get(roomId);
    if (!roomPresence || !roomPresence.playerIds.has(userId)) return null;

    const room = database ? listRooms(database).find(candidate => candidate.id === roomId) : null;
    const willBeEmpty = roomPresence.playerIds.size === 1;
    if (willBeEmpty && database) {
        deleteRoom(database, roomId);
    } else if (room && room.owner_id === userId) {
        transferRoomOwner(database, presence, room, userId, connectedOnlyForHandoff);
    }

    const result = leaveRoomPresence(presence, roomId, userId);
    if (result?.roomEmpty) deletePresenceRoom(presence, roomId);
    return result;
}

function handleReconnectExpired({ player, roomId }, server, database, presence, logger) {
    if (!roomId || !database || !presence.rooms.has(roomId)) return;

    try {
        const room = listRooms(database).find(candidate => candidate.id === roomId);
        if (!room) return;

        const match = presence.rooms.get(roomId)?.match;
        if (room.status === 'playing' && match && !match.ended) {
            expireMatchIfPastDeadline(match, roomId, presence);
        }

        if (room.status === 'playing' && room.mode === 'deathmatch') {
            if (match && !match.ended && player.status === 'active') {
                eliminatePlayer({
                    database,
                    presence,
                    roomId,
                    userId: player.userId,
                    reason: 'reconnect_expired'
                });
                const activePlayers = getRoomPresence(presence, roomId).players.filter(
                    candidate => candidate.status === 'active'
                );
                if (activePlayers.length === 0) {
                    finishMatch({
                        roomId,
                        presence,
                        winnerUserId: player.userId,
                        reason: 'last_player_disconnected'
                    });
                } else if (activePlayers.length === 1 && activePlayers[0].connected) {
                    finishMatch({
                        roomId,
                        presence,
                        winnerUserId: activePlayers[0].userId,
                        reason: 'last_player_standing'
                    });
                }
            }
            transferRoomOwner(database, presence, room, player.userId, true);
            broadcastRoomSnapshot(server, database, presence, roomId);
            return;
        }

        const result = removeRoomParticipant(database, presence, roomId, player.userId, true);
        if (result && !result.roomEmpty) {
            if (match) finishClassicIfReady(match, roomId, presence);
            if (match && !match.ended) broadcastRanking(roomId, presence);
            broadcastRoomSnapshot(server, database, presence, roomId);
        }
    } catch (error) {
        logger.error('Failed to handle reconnect expiry:', error.message);
    }
}

export function eliminatePlayer({ database, presence, roomId, userId, reason = 'wrong_answer' }) {
    if (!['wrong_answer', 'reconnect_expired'].includes(reason)) {
        throw new RangeError('Unsupported player elimination reason');
    }

    const room = database && listRooms(database).find(candidate => candidate.id === roomId);
    const roomPresence = presence.rooms.get(roomId);
    const player = presence.players.get(userId);
    const match = roomPresence?.match;
    if (
        !room ||
        room.status !== 'playing' ||
        room.mode !== 'deathmatch' ||
        !roomPresence ||
        match?.ended ||
        !player ||
        player.status !== 'active'
    ) {
        return null;
    }
    if (expireMatchIfPastDeadline(match, roomId, presence)) return null;

    const previousTargets = new Map(
        getRoomPresence(presence, roomId).spectators.map(spectator => [
            spectator.userId,
            spectator.targetUserId
        ])
    );
    let eliminated;
    try {
        eliminated = setPlayerSpectating(presence, roomId, userId);
    } catch (error) {
        if (error instanceof Error && error.message.includes('target must be an active player')) {
            return null;
        }
        throw error;
    }

    if (!match.eliminationOrder.includes(userId)) match.eliminationOrder.push(userId);
    const progress = match.progress.get(userId);
    if (progress) progress.status = 'eliminated';

    for (const activePlayer of getRoomPresence(presence, roomId).players) {
        if (activePlayer.status !== 'active') continue;
        const connection = presence.connections.get(activePlayer.userId);
        if (connection) {
            send(connection, 'player.eliminated', { user_id: userId, reason });
        }
    }

    const eliminatedConnection = presence.connections.get(userId);
    if (eliminatedConnection) {
        send(eliminatedConnection, 'spectator.started', {
            user_id: userId,
            target_user_id: eliminated.targetUserId
        });
    }

    const updatedPresence = getRoomPresence(presence, roomId);
    for (const spectator of updatedPresence.spectators) {
        if (
            spectator.userId !== userId &&
            previousTargets.get(spectator.userId) !== spectator.targetUserId
        ) {
            const connection = presence.connections.get(spectator.userId);
            if (connection) {
                send(connection, 'spectator.following', {
                    target_user_id: spectator.targetUserId
                });
            }
        }
    }

    broadcastRanking(roomId, presence);
    return { userId, targetUserId: eliminated.targetUserId };
}

function handleSpectatorFollow(socket, payload, requestId, presence) {
    if (
        !isRecord(payload) ||
        !hasOnlyFields(payload, new Set(['target_user_id'])) ||
        typeof payload.target_user_id !== 'string' ||
        !UUID_PATTERN.test(payload.target_user_id)
    ) {
        sendError(socket, 'INVALID_MESSAGE', 'Alvo do espectador inválido.', requestId);
        return;
    }

    const player = presence.players.get(socket.userId);
    if (!player?.roomId) {
        sendError(socket, 'NOT_IN_ROOM', 'Você não está em uma sala.', requestId);
        return;
    }
    const match = presence.rooms.get(player.roomId)?.match;
    if (match && (expireMatchIfPastDeadline(match, player.roomId, presence) || match.ended)) {
        sendError(socket, 'ACTION_NOT_ALLOWED', 'A partida não está em andamento.', requestId);
        return;
    }
    if (player.status !== 'spectating') {
        sendError(
            socket,
            'ACTION_NOT_ALLOWED',
            'Somente espectadores podem trocar de alvo.',
            requestId
        );
        return;
    }

    try {
        const spectator = setSpectatorTarget(
            presence,
            player.roomId,
            socket.userId,
            payload.target_user_id
        );
        send(socket, 'spectator.following', { target_user_id: spectator.targetUserId }, requestId);
    } catch {
        sendError(
            socket,
            'ACTION_NOT_ALLOWED',
            'O alvo deve ser um jogador ativo desta sala.',
            requestId
        );
    }
}

function handlePlayerMove(socket, payload, requestId, presence) {
    if (
        !isRecord(payload) ||
        !hasOnlyFields(payload, new Set(['sequence', 'direction'])) ||
        !Number.isSafeInteger(payload.sequence) ||
        payload.sequence < 0 ||
        !isMovementDirection(payload.direction)
    ) {
        sendError(socket, 'INVALID_MESSAGE', 'Intenção de movimento inválida.', requestId);
        return;
    }

    const player = presence.players.get(socket.userId);
    if (!player?.roomId) {
        sendError(socket, 'NOT_IN_ROOM', 'Você não está em uma sala.', requestId);
        return;
    }
    if (!player.connected || presence.connections.get(socket.userId) !== socket) {
        sendError(socket, 'ACTION_NOT_ALLOWED', 'Esta conexão não controla o jogador.', requestId);
        return;
    }
    if (player.status !== 'active') {
        sendError(socket, 'FORBIDDEN_ROLE', 'Espectadores não podem se movimentar.', requestId);
        return;
    }

    const roomPresence = presence.rooms.get(player.roomId);
    const match = roomPresence?.match;
    const movement = match?.movement.get(socket.userId);
    if (match && expireMatchIfPastDeadline(match, player.roomId, presence)) {
        sendError(socket, 'ACTION_NOT_ALLOWED', 'O tempo da partida terminou.', requestId);
        return;
    }
    if (!movement || match.ended) {
        sendError(socket, 'ACTION_NOT_ALLOWED', 'A partida não está em andamento.', requestId);
        return;
    }
    if (payload.sequence <= movement.sequence) {
        sendError(
            socket,
            'STALE_INPUT',
            'A sequência de movimento é antiga ou repetida.',
            requestId
        );
        return;
    }

    const position = movePosition(movement, payload.direction);
    Object.assign(movement, position, {
        direction: payload.direction,
        sequence: payload.sequence
    });
    match.movementRevision += 1;

    const event = {
        revision: match.movementRevision,
        user_id: socket.userId,
        sequence: movement.sequence,
        direction: movement.direction,
        x: movement.x,
        y: movement.y
    };
    const viewerIds = new Set(
        getPlayerViewers(presence, player.roomId, socket.userId).map(viewer => viewer.userId)
    );
    for (const participant of getRoomPresence(presence, player.roomId).players) {
        if (participant.status === 'active') viewerIds.add(participant.userId);
    }
    for (const viewerId of viewerIds) {
        const connection = presence.connections.get(viewerId);
        if (connection) send(connection, 'player.moved', event);
    }
}

function sendCurrentQuestion(socket, match, userId, progress) {
    const floor = match.players
        .get(userId)
        ?.find(playerFloor => playerFloor.floor === progress.floor);
    const notebook = floor?.notebooks[progress.notebookIndex];
    const question = notebook && match.questions.get(notebook.questionId);
    if (!notebook || !question) return false;

    send(socket, 'question.presented', {
        question_id: question.id,
        floor: progress.floor,
        notebook_id: notebook.notebookId,
        notebook_label: notebook.notebookLabel,
        prompt: question.prompt,
        options: [...question.options]
    });
    return true;
}

function openNextClassicFloor({ match, progress, roomId, userId, presence }) {
    if (expireMatchIfPastDeadline(match, roomId, presence)) return;

    const roomPresence = presence.rooms.get(roomId);
    if (
        roomPresence?.match !== match ||
        !roomPresence.playerIds.has(userId) ||
        progress.status !== 'cooldown'
    ) {
        return;
    }

    progress.doorTimer = null;
    progress.doorOpensAt = null;
    progress.floor += 1;
    progress.notebookIndex = 0;
    const player = presence.players.get(userId);
    if (progress.floor > match.players.get(userId).length) {
        markPlayerFinished(match, progress, presence.nowFn());
        finishClassicIfReady(match, roomId, presence);
        return;
    }

    progress.status = 'playing';
    recordFloorArrival(match, progress, presence.nowFn());
    const connection = presence.connections.get(userId);
    if (player?.connected && connection) sendCurrentQuestion(connection, match, userId, progress);
    broadcastRanking(roomId, presence);
}

function handleQuestionAnswer(socket, payload, requestId, database, presence) {
    if (
        !isRecord(payload) ||
        !hasOnlyFields(payload, new Set(['question_id', 'option_index'])) ||
        !Number.isSafeInteger(payload.question_id) ||
        payload.question_id < 1 ||
        !Number.isSafeInteger(payload.option_index) ||
        payload.option_index < 0
    ) {
        sendError(socket, 'INVALID_MESSAGE', 'Resposta inválida.', requestId);
        return;
    }

    const player = presence.players.get(socket.userId);
    if (!player?.roomId) {
        sendError(socket, 'NOT_IN_ROOM', 'Você não está em uma sala.', requestId);
        return;
    }
    if (!player.connected || presence.connections.get(socket.userId) !== socket) {
        sendError(socket, 'ACTION_NOT_ALLOWED', 'Esta conexão não controla o jogador.', requestId);
        return;
    }
    if (player.status !== 'active') {
        sendError(
            socket,
            'FORBIDDEN_ROLE',
            'Espectadores não podem responder questões.',
            requestId
        );
        return;
    }

    const room = database && listRooms(database).find(candidate => candidate.id === player.roomId);
    const match = presence.rooms.get(player.roomId)?.match;
    const progress = match?.progress.get(socket.userId);
    if (match && expireMatchIfPastDeadline(match, player.roomId, presence)) {
        sendError(socket, 'ACTION_NOT_ALLOWED', 'O tempo da partida terminou.', requestId);
        return;
    }
    if (
        room?.status !== 'playing' ||
        !['classic', 'deathmatch'].includes(room.mode) ||
        !match ||
        match.ended ||
        !progress
    ) {
        sendError(
            socket,
            'ACTION_NOT_ALLOWED',
            'A resposta não está disponível nesta partida.',
            requestId
        );
        return;
    }
    if (progress.status !== 'playing') {
        sendError(
            socket,
            'ACTION_NOT_ALLOWED',
            'Aguarde a abertura da porta antes de responder.',
            requestId
        );
        return;
    }

    const floor = match.players
        .get(socket.userId)
        ?.find(playerFloor => playerFloor.floor === progress.floor);
    const notebook = floor?.notebooks[progress.notebookIndex];
    const question = notebook && match.questions.get(notebook.questionId);
    if (
        !question ||
        question.id !== payload.question_id ||
        payload.option_index >= question.options.length
    ) {
        sendError(
            socket,
            'INVALID_ANSWER',
            'A questão ou alternativa não está disponível.',
            requestId
        );
        return;
    }

    const correct = payload.option_index === question.correct_option_index;
    const result = {
        question_id: question.id,
        correct,
        correct_option_index: question.correct_option_index,
        explanation: question.explanation,
        floor: progress.floor
    };

    if (room.mode === 'deathmatch') {
        if (correct) {
            progress.floor += 1;
            progress.notebookIndex = 0;
            if (progress.floor > match.players.get(socket.userId).length) {
                markPlayerFinished(match, progress, presence.nowFn());
                send(socket, 'answer.result', result, requestId);
                finishMatch({
                    roomId: player.roomId,
                    presence,
                    winnerUserId: socket.userId,
                    reason: 'questions_exhausted'
                });
            } else {
                recordFloorArrival(match, progress, presence.nowFn());
                send(socket, 'answer.result', result, requestId);
                sendCurrentQuestion(socket, match, socket.userId, progress);
                broadcastRanking(player.roomId, presence);
            }
            return;
        }

        send(socket, 'answer.result', result, requestId);
        eliminatePlayer({
            database,
            presence,
            roomId: player.roomId,
            userId: socket.userId,
            reason: 'wrong_answer'
        });
        const activePlayers = getRoomPresence(presence, player.roomId).players.filter(
            candidate => candidate.status === 'active'
        );
        if (activePlayers.length === 1 && activePlayers[0].connected) {
            finishMatch({
                roomId: player.roomId,
                presence,
                winnerUserId: activePlayers[0].userId,
                reason: 'last_player_standing'
            });
        } else if (activePlayers.length === 0) {
            finishMatch({
                roomId: player.roomId,
                presence,
                reason: 'no_players_remaining'
            });
        }
        return;
    }

    if (correct) {
        progress.floor += 1;
        progress.notebookIndex = 0;
        if (progress.floor > match.players.get(socket.userId).length) {
            markPlayerFinished(match, progress, presence.nowFn());
        } else {
            recordFloorArrival(match, progress, presence.nowFn());
            send(socket, 'answer.result', result, requestId);
            sendCurrentQuestion(socket, match, socket.userId, progress);
            broadcastRanking(player.roomId, presence);
            return;
        }
    } else {
        progress.notebookIndex += 1;
        if (progress.notebookIndex < floor.notebooks.length) {
            send(socket, 'answer.result', result, requestId);
            sendCurrentQuestion(socket, match, socket.userId, progress);
            return;
        }

        progress.status = 'cooldown';
        progress.doorOpensAt = presence.nowFn() + CLASSIC_DOOR_WAIT_MS;
        progress.doorTimer = presence.setTimeoutFn(
            () =>
                openNextClassicFloor({
                    match,
                    progress,
                    roomId: player.roomId,
                    userId: socket.userId,
                    presence
                }),
            CLASSIC_DOOR_WAIT_MS
        );
        progress.doorTimer.unref?.();
        result.retry_after_ms = CLASSIC_DOOR_WAIT_MS;
    }

    send(socket, 'answer.result', result, requestId);
    finishClassicIfReady(match, player.roomId, presence);
    if (!match.ended && correct) broadcastRanking(player.roomId, presence);
}

function ensurePresenceRooms(database, presence) {
    for (const room of listRooms(database)) {
        if (!presence.rooms.has(room.id)) createPresenceRoom(presence, room.id, room.mode);
    }
}

function handleHello(socket, payload, requestId, server, database, presence, logger) {
    if (
        !isRecord(payload) ||
        !hasOnlyFields(payload, SESSION_FIELDS) ||
        payload.protocol_version !== 1 ||
        typeof payload.user_id !== 'string' ||
        !UUID_PATTERN.test(payload.user_id) ||
        typeof payload.nickname !== 'string' ||
        payload.nickname.trim() === '' ||
        payload.nickname.length > 32 ||
        typeof payload.character_id !== 'string' ||
        payload.character_id.trim() === '' ||
        payload.character_id.length > 64
    ) {
        sendError(socket, 'INVALID_MESSAGE', 'Dados de sessão inválidos.', requestId);
        return;
    }

    if (socket.userId && socket.userId !== payload.user_id) {
        sendError(socket, 'ACTION_NOT_ALLOWED', 'Esta conexão já possui uma sessão.', requestId);
        return;
    }

    try {
        const { player, replacedConnection, resumed } = connectPlayer(
            presence,
            {
                userId: payload.user_id,
                nickname: payload.nickname,
                characterId: payload.character_id
            },
            socket
        );

        socket.userId = player.userId;
        if (replacedConnection && replacedConnection !== socket) {
            replacedConnection.close(4001, 'Session resumed on another connection');
        }

        send(socket, 'session.ready', { protocol_version: 1, user_id: player.userId }, requestId);

        if ((resumed || replacedConnection) && player.roomId && database) {
            const match = presence.rooms.get(player.roomId)?.match;
            const matchWasEnded = match?.ended ?? false;
            if (match) expireMatchIfPastDeadline(match, player.roomId, presence);
            broadcastRoomSnapshot(server, database, presence, player.roomId, socket);
            const progress = match?.progress.get(player.userId);
            if (match?.mode === 'deathmatch' && !match.ended) {
                const activePlayers = getRoomPresence(presence, player.roomId).players.filter(
                    participant => participant.status === 'active'
                );
                if (activePlayers.length === 1 && activePlayers[0].connected) {
                    finishMatch({
                        roomId: player.roomId,
                        presence,
                        winnerUserId: activePlayers[0].userId,
                        reason: 'last_player_standing'
                    });
                }
            }
            if (match && (!match.ended || matchWasEnded)) {
                send(socket, 'ranking.updated', {
                    revision: match.rankingRevision,
                    entries: buildRankingEntries(player.roomId, presence)
                });
            }
            if (
                match &&
                !match.ended &&
                player.status === 'active' &&
                progress?.status === 'playing'
            ) {
                sendCurrentQuestion(socket, match, player.userId, progress);
            }
        }
    } catch (error) {
        logger.error('Failed to establish WebSocket session:', error.message);
        sendError(socket, 'ACTION_NOT_ALLOWED', error.message, requestId);
    }
}

function handleRoomCreate(socket, payload, requestId, database, presence, logger) {
    if (!isRecord(payload) || !hasOnlyFields(payload, ROOM_CREATE_FIELDS)) {
        sendError(socket, 'INVALID_ROOM_SETTINGS', 'Configuração da sala inválida.', requestId);
        return;
    }
    if (!database) {
        sendError(socket, 'INTERNAL_ERROR', 'Persistência de salas indisponível.', requestId, true);
        return;
    }

    const player = presence.players.get(socket.userId);
    if (!player || player.roomId) {
        sendError(
            socket,
            'ACTION_NOT_ALLOWED',
            'Saia da sala atual antes de criar outra.',
            requestId
        );
        return;
    }

    const roomId = randomUUID();
    let roomCreated = false;
    try {
        const room = createRoom(database, {
            id: roomId,
            owner_id: socket.userId,
            ...payload
        });
        roomCreated = true;
        createPresenceRoom(presence, roomId, room.mode);
        joinRoomPresence(presence, roomId, socket.userId);

        const snapshot = roomSnapshot(database, presence, roomId);
        if (!snapshot) throw new Error('Created room could not be loaded');
        send(socket, 'room.snapshot', snapshot, requestId);
    } catch (error) {
        if (roomCreated) {
            deletePresenceRoom(presence, roomId);
            deleteRoom(database, roomId);
        }
        logger.error('Failed to create room:', error.message);
        const settingsError = error instanceof TypeError || error instanceof RangeError;
        sendError(
            socket,
            settingsError ? 'INVALID_ROOM_SETTINGS' : 'INTERNAL_ERROR',
            settingsError ? error.message : 'Não foi possível criar a sala.',
            requestId,
            !settingsError
        );
    }
}

function handleRoomList(socket, payload, requestId, database, presence, logger) {
    if (!isRecord(payload) || Object.keys(payload).length !== 0) {
        sendError(
            socket,
            'INVALID_MESSAGE',
            'A consulta de salas não aceita parâmetros.',
            requestId
        );
        return;
    }
    if (!database) {
        sendError(socket, 'INTERNAL_ERROR', 'Persistência de salas indisponível.', requestId, true);
        return;
    }

    try {
        const rooms = listRooms(database, { status: 'waiting' }).map(room => {
            if (!presence.rooms.has(room.id)) createPresenceRoom(presence, room.id, room.mode);
            return {
                room_id: room.id,
                name: room.name,
                mode: room.mode,
                floors: room.floors,
                notebooks_per_floor: room.notebooks_per_floor,
                time_limit_seconds: room.time_limit_seconds,
                max_players: room.max_players,
                player_count: presence.rooms.get(room.id).playerIds.size,
                status: room.status
            };
        });
        send(socket, 'rooms.list', { rooms }, requestId);
    } catch (error) {
        logger.error('Failed to list rooms:', error.message);
        sendError(socket, 'INTERNAL_ERROR', 'Não foi possível listar as salas.', requestId, true);
    }
}

function handleRoomJoin(socket, payload, requestId, server, database, presence, logger) {
    if (
        !isRecord(payload) ||
        !hasOnlyFields(payload, new Set(['room_id'])) ||
        typeof payload.room_id !== 'string' ||
        !UUID_PATTERN.test(payload.room_id)
    ) {
        sendError(socket, 'INVALID_MESSAGE', 'Identificador de sala inválido.', requestId);
        return;
    }
    if (!database) {
        sendError(socket, 'INTERNAL_ERROR', 'Persistência de salas indisponível.', requestId, true);
        return;
    }

    const room = listRooms(database).find(candidate => candidate.id === payload.room_id);
    if (!room) {
        sendError(socket, 'ROOM_NOT_FOUND', 'A sala não existe ou já foi removida.', requestId);
        return;
    }

    const player = presence.players.get(socket.userId);
    if (!player) {
        sendError(socket, 'SESSION_REQUIRED', 'Envie session.hello antes de entrar.', requestId);
        return;
    }
    if (player.roomId === room.id) {
        send(socket, 'room.snapshot', roomSnapshot(database, presence, room.id), requestId);
        return;
    }
    if (player.roomId) {
        sendError(
            socket,
            'ACTION_NOT_ALLOWED',
            'Saia da sala atual antes de entrar em outra.',
            requestId
        );
        return;
    }
    if (room.status !== 'waiting') {
        sendError(socket, 'ROOM_IN_PROGRESS', 'A partida desta sala já começou.', requestId);
        return;
    }

    try {
        if (!presence.rooms.has(room.id)) createPresenceRoom(presence, room.id, room.mode);
        const roomPresence = presence.rooms.get(room.id);
        if (roomPresence.playerIds.size >= room.max_players) {
            sendError(socket, 'ROOM_FULL', 'A sala está cheia.', requestId);
            return;
        }

        joinRoomPresence(presence, room.id, socket.userId);
        broadcastRoomSnapshot(server, database, presence, room.id, socket, requestId);
    } catch (error) {
        logger.error('Failed to join room:', error.message);
        sendError(socket, 'INTERNAL_ERROR', 'Não foi possível entrar na sala.', requestId, true);
    }
}

function handleRoomLeave(socket, payload, requestId, server, database, presence, logger) {
    if (!isRecord(payload) || Object.keys(payload).length !== 0) {
        sendError(socket, 'INVALID_MESSAGE', 'room.leave não aceita parâmetros.', requestId);
        return;
    }

    const player = presence.players.get(socket.userId);
    if (!player?.roomId) {
        sendError(socket, 'NOT_IN_ROOM', 'Você não está em uma sala.', requestId);
        return;
    }

    const roomId = player.roomId;
    try {
        const match = presence.rooms.get(roomId)?.match;
        if (match) expireMatchIfPastDeadline(match, roomId, presence);
        const result = removeRoomParticipant(database, presence, roomId, socket.userId, false);
        if (!result) {
            sendError(socket, 'NOT_IN_ROOM', 'Você não está nesta sala.', requestId);
            return;
        }

        send(socket, 'room.left', { room_id: roomId }, requestId);
        if (database && !result.roomEmpty) {
            if (match) finishClassicIfReady(match, roomId, presence);
            if (match && !match.ended) broadcastRanking(roomId, presence);
            broadcastRoomSnapshot(server, database, presence, roomId);
        }
    } catch (error) {
        logger.error('Failed to leave room:', error.message);
        sendError(socket, 'INTERNAL_ERROR', 'Não foi possível sair da sala.', requestId, true);
    }
}

function handleRoomConfigure(socket, payload, requestId, server, database, presence, logger) {
    if (
        !isRecord(payload) ||
        Object.keys(payload).length === 0 ||
        !hasOnlyFields(payload, ROOM_CONFIGURE_FIELDS)
    ) {
        sendError(socket, 'INVALID_ROOM_SETTINGS', 'Configuração da sala inválida.', requestId);
        return;
    }
    if (!database) {
        sendError(socket, 'INTERNAL_ERROR', 'Persistência de salas indisponível.', requestId, true);
        return;
    }

    const player = presence.players.get(socket.userId);
    if (!player?.roomId) {
        sendError(socket, 'NOT_IN_ROOM', 'Você não está em uma sala.', requestId);
        return;
    }

    const room = listRooms(database).find(candidate => candidate.id === player.roomId);
    if (!room) {
        sendError(socket, 'ROOM_NOT_FOUND', 'A sala não existe ou já foi removida.', requestId);
        return;
    }
    if (room.owner_id !== socket.userId) {
        sendError(socket, 'NOT_ROOM_OWNER', 'Somente o owner pode alterar a sala.', requestId);
        return;
    }
    if (room.status !== 'waiting') {
        sendError(socket, 'ROOM_IN_PROGRESS', 'A partida desta sala já começou.', requestId);
        return;
    }

    try {
        const roomPresence = presence.rooms.get(room.id);
        if (
            payload.max_players !== undefined &&
            payload.max_players < roomPresence.playerIds.size
        ) {
            throw new RangeError('max_players cannot be lower than the current player count');
        }

        const updatedRoom = updateRoom(database, room.id, payload);
        roomPresence.mode = updatedRoom.mode;
        roomPresence.revision += 1;
        broadcastRoomSnapshot(server, database, presence, room.id, socket, requestId);
    } catch (error) {
        const settingsError = error instanceof TypeError || error instanceof RangeError;
        if (!settingsError) logger.error('Failed to configure room:', error.message);
        sendError(
            socket,
            settingsError ? 'INVALID_ROOM_SETTINGS' : 'INTERNAL_ERROR',
            settingsError ? error.message : 'Não foi possível atualizar a sala.',
            requestId,
            !settingsError
        );
    }
}

function handleMatchStart(socket, payload, requestId, server, database, presence, logger) {
    if (!isRecord(payload) || Object.keys(payload).length !== 0) {
        sendError(socket, 'INVALID_MESSAGE', 'match.start não aceita parâmetros.', requestId);
        return;
    }
    if (!database) {
        sendError(socket, 'INTERNAL_ERROR', 'Persistência de salas indisponível.', requestId, true);
        return;
    }

    const player = presence.players.get(socket.userId);
    if (!player?.roomId) {
        sendError(socket, 'NOT_IN_ROOM', 'Você não está em uma sala.', requestId);
        return;
    }

    const room = listRooms(database).find(candidate => candidate.id === player.roomId);
    if (!room) {
        sendError(socket, 'ROOM_NOT_FOUND', 'A sala não existe ou já foi removida.', requestId);
        return;
    }
    if (room.owner_id !== socket.userId) {
        sendError(socket, 'NOT_ROOM_OWNER', 'Somente o owner pode iniciar a partida.', requestId);
        return;
    }
    if (room.status !== 'waiting') {
        sendError(socket, 'ROOM_IN_PROGRESS', 'A partida desta sala já começou.', requestId);
        return;
    }

    try {
        const questions = database
            .prepare(
                `SELECT id, prompt, options, correct_option_index, explanation
                FROM questions ORDER BY id`
            )
            .all()
            .map(question => ({ ...question, options: JSON.parse(question.options) }));
        const matchDistribution = createMatchDistribution({
            mode: room.mode,
            floors: room.floors,
            notebooksPerFloor: room.notebooks_per_floor,
            questions,
            playerIds: getRoomPresence(presence, room.id).players.map(player => player.userId)
        });
        matchDistribution.startedAt = presence.nowFn();
        matchDistribution.deadline =
            room.time_limit_seconds === null
                ? null
                : matchDistribution.startedAt + room.time_limit_seconds * 1000;

        updateRoom(database, room.id, { status: 'playing' });
        const roomPresence = presence.rooms.get(room.id);
        roomPresence.match = matchDistribution;
        roomPresence.revision += 1;
        scheduleMatchTimeout(matchDistribution, room.id, presence);

        const snapshot = roomSnapshot(database, presence, room.id);
        for (const participant of snapshot.participants) {
            const connection = presence.connections.get(participant.user_id);
            if (connection) {
                send(
                    connection,
                    'match.started',
                    { room_id: room.id },
                    connection === socket ? requestId : undefined
                );
            }
        }
        broadcastRoomSnapshot(server, database, presence, room.id);
        if (room.mode === 'deathmatch' && snapshot.participants.length === 1) {
            finishMatch({
                roomId: room.id,
                presence,
                winnerUserId: snapshot.participants[0].user_id,
                reason: 'last_player_standing'
            });
        } else {
            broadcastRanking(room.id, presence);
            for (const participant of snapshot.participants) {
                const connection = presence.connections.get(participant.user_id);
                const progress = matchDistribution.progress.get(participant.user_id);
                if (connection && progress) {
                    sendCurrentQuestion(
                        connection,
                        matchDistribution,
                        participant.user_id,
                        progress
                    );
                }
            }
        }
    } catch (error) {
        if (error.code === 'INSUFFICIENT_QUESTIONS') {
            sendError(
                socket,
                'INSUFFICIENT_QUESTIONS',
                'O catálogo não contém questões distintas suficientes para esta partida.',
                requestId
            );
            return;
        }
        logger.error('Failed to start match:', error.message);
        sendError(socket, 'INTERNAL_ERROR', 'Não foi possível iniciar a partida.', requestId, true);
    }
}

export function attachRoomProtocol(server, { database, presence, logger = console }) {
    if (database) ensurePresenceRooms(database, presence);
    const previousReconnectHandler = presence.onReconnectExpired;
    presence.onReconnectExpired = event => {
        try {
            previousReconnectHandler(event);
        } catch (error) {
            logger.error('Reconnect expiry listener failed:', error.message);
        }
        handleReconnectExpired(event, server, database, presence, logger);
    };
    server.on('connection', socket =>
        attachSocketProtocol(socket, { server, database, presence, logger })
    );
}

function attachSocketProtocol(socket, context) {
    const { server, database, presence, logger } = context;

    socket.on('message', (data, isBinary) => {
        let message;
        try {
            if (isBinary) throw new TypeError('Binary messages are not supported');
            message = JSON.parse(data.toString('utf8'));
        } catch {
            sendError(socket, 'INVALID_MESSAGE', 'A mensagem deve ser JSON válido em texto.');
            return;
        }

        if (
            !isRecord(message) ||
            typeof message.type !== 'string' ||
            !isRecord(message.payload) ||
            (message.request_id !== undefined &&
                (typeof message.request_id !== 'string' || message.request_id.trim() === ''))
        ) {
            sendError(socket, 'INVALID_MESSAGE', 'Envelope da mensagem inválido.');
            return;
        }

        const requestId = message.request_id;
        if (message.type !== 'session.hello' && !socket.userId) {
            sendError(
                socket,
                'SESSION_REQUIRED',
                'Envie session.hello antes deste comando.',
                requestId
            );
            return;
        }
        if (
            [
                'session.hello',
                'rooms.list.request',
                'room.create',
                'room.join',
                'room.leave',
                'room.configure',
                'match.start',
                'spectator.follow',
                'question.answer'
            ].includes(message.type) &&
            !requestId
        ) {
            sendError(socket, 'INVALID_MESSAGE', 'Esta mensagem exige request_id.');
            return;
        }

        switch (message.type) {
            case 'session.hello':
                handleHello(socket, message.payload, requestId, server, database, presence, logger);
                break;
            case 'rooms.list.request':
                handleRoomList(socket, message.payload, requestId, database, presence, logger);
                break;
            case 'room.create':
                handleRoomCreate(socket, message.payload, requestId, database, presence, logger);
                break;
            case 'room.join':
                handleRoomJoin(
                    socket,
                    message.payload,
                    requestId,
                    server,
                    database,
                    presence,
                    logger
                );
                break;
            case 'room.leave':
                handleRoomLeave(
                    socket,
                    message.payload,
                    requestId,
                    server,
                    database,
                    presence,
                    logger
                );
                break;
            case 'room.configure':
                handleRoomConfigure(
                    socket,
                    message.payload,
                    requestId,
                    server,
                    database,
                    presence,
                    logger
                );
                break;
            case 'match.start':
                handleMatchStart(
                    socket,
                    message.payload,
                    requestId,
                    server,
                    database,
                    presence,
                    logger
                );
                break;
            case 'spectator.follow':
                handleSpectatorFollow(socket, message.payload, requestId, presence);
                break;
            case 'player.move':
                handlePlayerMove(socket, message.payload, requestId, presence);
                break;
            case 'question.answer':
                handleQuestionAnswer(socket, message.payload, requestId, database, presence);
                break;
            default:
                sendError(socket, 'INVALID_MESSAGE', 'Tipo de mensagem desconhecido.', requestId);
        }
    });

    socket.on('close', () => {
        if (socket.userId) {
            const roomId = presence.players.get(socket.userId)?.roomId;
            if (disconnectPlayer(presence, socket.userId, socket) && roomId && database) {
                broadcastRoomSnapshot(server, database, presence, roomId);
            }
        }
    });
}
