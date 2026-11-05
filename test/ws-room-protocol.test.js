import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { startWebSocketServer, closeWebSocketServer } from '../ws/server.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const logger = { info() {}, error() {} };
const playerId = '11111111-1111-4111-8111-111111111111';

let database;
let server;
const clients = new Set();

async function connectClient() {
    const address = server.address();
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    client.on('error', () => {});
    clients.add(client);
    await once(client, 'open');
    return client;
}

function sendRequest(client, message) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client.off('message', onMessage);
            reject(new Error(`Timed out waiting for ${message.request_id}`));
        }, 1000);

        function onMessage(data) {
            const response = JSON.parse(data.toString('utf8'));
            if (response.request_id !== message.request_id) return;
            clearTimeout(timeout);
            client.off('message', onMessage);
            resolve(response);
        }

        client.on('message', onMessage);
        client.send(JSON.stringify(message));
    });
}

async function sendInvalidText(client, text) {
    const responsePromise = once(client, 'message');
    client.send(text);
    const [data] = await responsePromise;
    return JSON.parse(data.toString('utf8'));
}

async function hello(client, id = playerId) {
    return sendRequest(client, {
        type: 'session.hello',
        request_id: 'hello-1',
        payload: {
            protocol_version: 1,
            user_id: id,
            nickname: 'Player One',
            character_id: 'avatar-1'
        }
    });
}

beforeEach(async () => {
    database = new Database(':memory:');
    database.exec(schema);
    server = await startWebSocketServer({ host: '127.0.0.1', port: 0, database, logger });
});

afterEach(async () => {
    if (server) {
        await closeWebSocketServer(server);
        server = null;
    }
    clients.clear();
    database.close();
});

describe('room creation and listing WebSocket events', () => {
    it('requires a valid session and returns predictable errors for malformed input', async () => {
        const client = await connectClient();
        const sessionRequired = await sendRequest(client, {
            type: 'rooms.list.request',
            request_id: 'list-before-session',
            payload: {}
        });
        assert.equal(sessionRequired.type, 'error');
        assert.equal(sessionRequired.payload.code, 'SESSION_REQUIRED');

        const malformed = await sendInvalidText(client, '{not-json');
        assert.equal(malformed.type, 'error');
        assert.equal(malformed.payload.code, 'INVALID_MESSAGE');

        const invalidHello = await sendRequest(client, {
            type: 'session.hello',
            request_id: 'bad-hello',
            payload: { protocol_version: 1, user_id: 'not-a-uuid' }
        });
        assert.equal(invalidHello.type, 'error');
        assert.equal(invalidHello.payload.code, 'INVALID_MESSAGE');

        const ready = await hello(client);
        assert.equal(ready.type, 'session.ready');
        assert.equal(ready.payload.user_id, playerId);
    });

    it('creates a validated room with the creator as owner and first participant', async () => {
        const client = await connectClient();
        await hello(client);

        const invalidSettings = await sendRequest(client, {
            type: 'room.create',
            request_id: 'invalid-room',
            payload: {
                name: 'Bad room',
                mode: 'deathmatch',
                floors: 5,
                notebooks_per_floor: 2,
                time_limit_seconds: 120,
                max_players: 4
            }
        });
        assert.equal(invalidSettings.type, 'error');
        assert.equal(invalidSettings.payload.code, 'INVALID_ROOM_SETTINGS');
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rooms').get().count, 0);

        const created = await sendRequest(client, {
            type: 'room.create',
            request_id: 'create-room',
            payload: {
                name: 'Study hall',
                mode: 'classic',
                floors: 8,
                notebooks_per_floor: 2,
                time_limit_seconds: null,
                max_players: 6
            }
        });

        assert.equal(created.type, 'room.snapshot');
        assert.equal(created.request_id, 'create-room');
        assert.equal(created.payload.room.owner_id, playerId);
        assert.equal(created.payload.room.status, 'waiting');
        assert.deepEqual(created.payload.participants, [
            {
                user_id: playerId,
                nickname: 'Player One',
                character_id: 'avatar-1',
                role: 'player'
            }
        ]);
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rooms').get().count, 1);
    });

    it('lists waiting rooms and uses in-memory presence for player counts', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-for-list',
            payload: {
                name: 'Visible room',
                mode: 'classic',
                floors: 5,
                notebooks_per_floor: 1,
                time_limit_seconds: 60,
                max_players: 3
            }
        });
        const roomId = created.payload.room.room_id;

        const requester = await connectClient();
        await hello(requester, '22222222-2222-4222-8222-222222222222');
        const listed = await sendRequest(requester, {
            type: 'rooms.list.request',
            request_id: 'list-rooms',
            payload: {}
        });

        assert.equal(listed.type, 'rooms.list');
        assert.equal(listed.request_id, 'list-rooms');
        assert.equal(listed.payload.rooms.length, 1);
        assert.deepEqual(listed.payload.rooms[0], {
            room_id: roomId,
            name: 'Visible room',
            mode: 'classic',
            floors: 5,
            notebooks_per_floor: 1,
            time_limit_seconds: 60,
            max_players: 3,
            player_count: 1,
            status: 'waiting'
        });
    });

    it('rejects unknown message types and extra list parameters', async () => {
        const client = await connectClient();
        await hello(client);

        const unknown = await sendRequest(client, {
            type: 'room.delete',
            request_id: 'unknown-event',
            payload: {}
        });
        assert.equal(unknown.payload.code, 'INVALID_MESSAGE');

        const invalidList = await sendRequest(client, {
            type: 'rooms.list.request',
            request_id: 'list-with-filter',
            payload: { status: 'playing' }
        });
        assert.equal(invalidList.payload.code, 'INVALID_MESSAGE');
    });
});
