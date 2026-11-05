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
    leaveRoomPresence
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
        const result = leaveRoomPresence(presence, roomId, socket.userId);
        if (!result) {
            sendError(socket, 'NOT_IN_ROOM', 'Você não está nesta sala.', requestId);
            return;
        }

        send(socket, 'room.left', { room_id: roomId }, requestId);
        if (database && presence.rooms.has(roomId)) {
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
                'match.start'
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
