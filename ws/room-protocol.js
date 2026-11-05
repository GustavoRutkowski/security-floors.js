import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRoom, deleteRoom, listRooms } from '../db/rooms.js';
import {
    connectPlayer,
    createPresenceRoom,
    deletePresenceRoom,
    disconnectPlayer,
    getRoomPresence,
    joinRoomPresence
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
        revision: 1,
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
            role: 'player'
        }))
    };
}

function ensurePresenceRooms(database, presence) {
    for (const room of listRooms(database)) {
        if (!presence.rooms.has(room.id)) createPresenceRoom(presence, room.id, room.mode);
    }
}

function handleHello(socket, payload, requestId, database, presence, logger) {
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

        if (resumed && player.roomId && database) {
            const snapshot = roomSnapshot(database, presence, player.roomId);
            if (snapshot) send(socket, 'room.snapshot', snapshot);
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

export function attachRoomProtocol(server, { database, presence, logger = console }) {
    if (database) ensurePresenceRooms(database, presence);
    server.on('connection', socket => attachSocketProtocol(socket, { database, presence, logger }));
}

function attachSocketProtocol(socket, context) {
    const { database, presence, logger } = context;

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
            ['session.hello', 'rooms.list.request', 'room.create'].includes(message.type) &&
            !requestId
        ) {
            sendError(socket, 'INVALID_MESSAGE', 'Esta mensagem exige request_id.');
            return;
        }

        switch (message.type) {
            case 'session.hello':
                handleHello(socket, message.payload, requestId, database, presence, logger);
                break;
            case 'rooms.list.request':
                handleRoomList(socket, message.payload, requestId, database, presence, logger);
                break;
            case 'room.create':
                handleRoomCreate(socket, message.payload, requestId, database, presence, logger);
                break;
            default:
                sendError(socket, 'INVALID_MESSAGE', 'Tipo de mensagem desconhecido.', requestId);
        }
    });

    socket.on('close', () => {
        if (socket.userId) disconnectPlayer(presence, socket.userId, socket);
    });
}
