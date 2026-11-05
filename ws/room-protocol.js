import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRoom, deleteRoom, listRooms, updateRoom } from '../db/rooms.js';
import {
    connectPlayer,
    createPresenceRoom,
    deletePresenceRoom,
    disconnectPlayer,
    getRoomPresence,
    joinRoomPresence,
    leaveRoomPresence,
    setPlayerSpectating,
    setSpectatorTarget
} from './presence.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

        if (room.status === 'playing' && room.mode === 'deathmatch') {
            eliminatePlayer({
                database,
                presence,
                roomId,
                userId: player.userId,
                reason: 'reconnect_expired'
            });
            transferRoomOwner(database, presence, room, player.userId, true);
            broadcastRoomSnapshot(server, database, presence, roomId);
            return;
        }

        const result = removeRoomParticipant(database, presence, roomId, player.userId, true);
        if (result && !result.roomEmpty) broadcastRoomSnapshot(server, database, presence, roomId);
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
    if (
        !room ||
        room.status !== 'playing' ||
        room.mode !== 'deathmatch' ||
        !roomPresence ||
        !player ||
        player.status !== 'active'
    ) {
        return null;
    }

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
            broadcastRoomSnapshot(server, database, presence, player.roomId, socket);
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
        const result = removeRoomParticipant(database, presence, roomId, socket.userId, false);
        if (!result) {
            sendError(socket, 'NOT_IN_ROOM', 'Você não está nesta sala.', requestId);
            return;
        }

        send(socket, 'room.left', { room_id: roomId }, requestId);
        if (database && !result.roomEmpty) {
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
        const requiredQuestionCount =
            room.floors * (room.mode === 'classic' ? room.notebooks_per_floor : 1);
        const questionCount = database
            .prepare('SELECT COUNT(*) AS count FROM questions')
            .get().count;
        if (questionCount < requiredQuestionCount) {
            sendError(
                socket,
                'INSUFFICIENT_QUESTIONS',
                'O catálogo não contém questões distintas suficientes para esta partida.',
                requestId
            );
            return;
        }

        updateRoom(database, room.id, { status: 'playing' });
        presence.rooms.get(room.id).revision += 1;
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
    } catch (error) {
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
                'spectator.follow'
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
