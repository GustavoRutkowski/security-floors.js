import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { createRoom, updateRoom } from '../db/rooms.js';
import { getNotebookTiles } from '../map-layout.js';
import { createPresenceState, getPlayerViewers } from '../ws/presence.js';
import { eliminatePlayer } from '../ws/room-protocol.js';
import { startWebSocketServer, closeWebSocketServer } from '../ws/server.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const logger = { info() {}, error() {} };
const playerId = '11111111-1111-4111-8111-111111111111';

let database;
let server;
let disconnectTimers;
let now;
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

function waitForMessage(client, type, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client.off('message', onMessage);
            reject(new Error(`Timed out waiting for ${type}`));
        }, 1000);

        function onMessage(data) {
            const message = JSON.parse(data.toString('utf8'));
            if (message.type !== type || !predicate(message.payload)) return;
            clearTimeout(timeout);
            client.off('message', onMessage);
            resolve(message);
        }

        client.on('message', onMessage);
    });
}

async function moveUntil(client, userId, match, direction, shouldStop, prefix) {
    for (let step = 0; step < 100 && !shouldStop(); step += 1) {
        const movement = match.movement.get(userId);
        const sequence = movement.sequence + 1;
        const updatePromise = waitForMessage(
            client,
            'player.moved',
            payload => payload.user_id === userId && payload.sequence === sequence
        );
        client.send(
            JSON.stringify({
                type: 'player.move',
                payload: { sequence, direction }
            })
        );
        await updatePromise;
    }
    assert.equal(shouldStop(), true, `Movement route did not reach its ${prefix} target`);
}

async function walkThroughOpenDoor(client, userId, match, prefix, finishRun = false) {
    const progress = match.progress.get(userId);
    const currentFloor = progress.floor;
    await moveUntil(
        client,
        userId,
        match,
        'east',
        () => match.movement.get(userId).x >= 65,
        `${prefix} staging x`
    );
    await moveUntil(
        client,
        userId,
        match,
        'north',
        () => match.movement.get(userId).y <= 18,
        `${prefix} staging y`
    );
    await moveUntil(
        client,
        userId,
        match,
        'west',
        () => match.movement.get(userId).x <= 50,
        `${prefix} doorway x`
    );
    await moveUntil(
        client,
        userId,
        match,
        'north',
        () => (finishRun ? progress.status === 'finished' : progress.floor !== currentFloor),
        `${prefix} floor transition`
    );
}

function insertQuestions(count) {
    const insertQuestion = database.prepare(`
        INSERT INTO questions (id, prompt, options, correct_option_index)
        VALUES (?, ?, ?, ?)
    `);
    for (let id = 1; id <= count; id += 1) {
        insertQuestion.run(id, `Question ${id}`, JSON.stringify(['A', 'B']), 0);
    }
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

async function joinGuest(roomId, requestId) {
    const guest = await connectClient();
    await hello(guest, '22222222-2222-4222-8222-222222222222');
    await sendRequest(guest, {
        type: 'room.join',
        request_id: requestId,
        payload: { room_id: roomId }
    });
    return guest;
}

beforeEach(async () => {
    database = new Database(':memory:');
    database.exec(schema);
    disconnectTimers = [];
    now = 1000;
    const presence = createPresenceState({
        nowFn: () => now,
        setTimeoutFn(callback, delay) {
            const timer = { callback, delay, cleared: false, unref() {} };
            disconnectTimers.push(timer);
            return timer;
        },
        clearTimeoutFn(timer) {
            timer.cleared = true;
        }
    });
    server = await startWebSocketServer({
        host: '127.0.0.1',
        port: 0,
        database,
        logger,
        presence
    });
});

afterEach(async () => {
    const pendingClientCloses = [...clients]
        .filter(client => client.readyState !== WebSocket.CLOSED)
        .map(client => once(client, 'close'));
    if (server) {
        await closeWebSocketServer(server);
        server = null;
    }
    await Promise.all(pendingClientCloses);
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
                role: 'player',
                connected: true
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

    it('joins and leaves rooms while broadcasting updated participant snapshots', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-join',
            payload: {
                name: 'Shared room',
                mode: 'classic',
                floors: 5,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;

        const guest = await connectClient();
        await hello(guest, '22222222-2222-4222-8222-222222222222');
        const ownerJoinBroadcast = once(owner, 'message').then(([data]) =>
            JSON.parse(data.toString('utf8'))
        );
        const joined = await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-room',
            payload: { room_id: roomId }
        });
        const ownerJoinSnapshot = await ownerJoinBroadcast;

        assert.equal(joined.type, 'room.snapshot');
        assert.equal(joined.request_id, 'join-room');
        assert.equal(joined.payload.revision, 2);
        assert.equal(joined.payload.participants.length, 2);
        assert.equal(ownerJoinSnapshot.type, 'room.snapshot');
        assert.equal(ownerJoinSnapshot.payload.revision, 2);
        assert.deepEqual(
            ownerJoinSnapshot.payload.participants.map(participant => participant.user_id),
            [playerId, '22222222-2222-4222-8222-222222222222']
        );

        const repeatedJoin = await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-room-retry',
            payload: { room_id: roomId }
        });
        assert.equal(repeatedJoin.type, 'room.snapshot');
        assert.equal(repeatedJoin.payload.revision, 2);
        assert.equal(repeatedJoin.payload.participants.length, 2);

        const ownerLeaveBroadcast = once(owner, 'message').then(([data]) =>
            JSON.parse(data.toString('utf8'))
        );
        const left = await sendRequest(guest, {
            type: 'room.leave',
            request_id: 'leave-room',
            payload: {}
        });
        const ownerLeaveSnapshot = await ownerLeaveBroadcast;

        assert.equal(left.type, 'room.left');
        assert.equal(left.request_id, 'leave-room');
        assert.equal(left.payload.room_id, roomId);
        assert.equal(ownerLeaveSnapshot.type, 'room.snapshot');
        assert.equal(ownerLeaveSnapshot.payload.revision, 3);
        assert.deepEqual(
            ownerLeaveSnapshot.payload.participants.map(participant => participant.user_id),
            [playerId]
        );

        const repeatedLeave = await sendRequest(guest, {
            type: 'room.leave',
            request_id: 'leave-room-again',
            payload: {}
        });
        assert.equal(repeatedLeave.payload.code, 'NOT_IN_ROOM');
    });

    it('rejects missing, full, in-progress, and conflicting room joins', async () => {
        const owner = await connectClient();
        await hello(owner);
        const firstRoom = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-full-room',
            payload: {
                name: 'Full room',
                mode: 'classic',
                floors: 5,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 1
            }
        });
        const firstRoomId = firstRoom.payload.room.room_id;

        const guest = await connectClient();
        await hello(guest, '22222222-2222-4222-8222-222222222222');

        const missing = await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-missing-room',
            payload: { room_id: '33333333-3333-4333-8333-333333333333' }
        });
        assert.equal(missing.payload.code, 'ROOM_NOT_FOUND');

        const spectatorEntry = await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-as-spectator',
            payload: { room_id: firstRoomId, role: 'spectator' }
        });
        assert.equal(spectatorEntry.payload.code, 'INVALID_MESSAGE');

        const full = await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-full-room',
            payload: { room_id: firstRoomId }
        });
        assert.equal(full.payload.code, 'ROOM_FULL');

        updateRoom(database, firstRoomId, { status: 'playing' });
        const inProgress = await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-in-progress-room',
            payload: { room_id: firstRoomId }
        });
        assert.equal(inProgress.payload.code, 'ROOM_IN_PROGRESS');

        const availableRoom = createRoom(database, {
            id: '44444444-4444-4444-8444-444444444444',
            name: 'Other room',
            owner_id: playerId,
            mode: 'classic',
            floors: 5,
            notebooks_per_floor: 1,
            time_limit_seconds: null,
            max_players: 4
        });
        const joinedOtherRoom = await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-other-room',
            payload: { room_id: availableRoom.id }
        });
        assert.equal(joinedOtherRoom.type, 'room.snapshot');

        const secondAvailableRoom = createRoom(database, {
            id: '55555555-5555-4555-8555-555555555555',
            name: 'Third room',
            owner_id: playerId,
            mode: 'classic',
            floors: 5,
            notebooks_per_floor: 1,
            time_limit_seconds: null,
            max_players: 4
        });
        const conflictingJoin = await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-second-room',
            payload: { room_id: secondAvailableRoom.id }
        });
        assert.equal(conflictingJoin.type, 'error');
        assert.equal(conflictingJoin.payload.code, 'ACTION_NOT_ALLOWED');
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

    it('allows only the owner to update waiting-room settings', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-configurable-room',
            payload: {
                name: 'Before',
                mode: 'classic',
                floors: 5,
                notebooks_per_floor: 2,
                time_limit_seconds: null,
                max_players: 3
            }
        });

        const guest = await connectClient();
        await hello(guest, '22222222-2222-4222-8222-222222222222');
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-configurable-room',
            payload: { room_id: created.payload.room.room_id }
        });

        const denied = await sendRequest(guest, {
            type: 'room.configure',
            request_id: 'guest-configure',
            payload: { name: 'Unauthorized' }
        });
        assert.equal(denied.payload.code, 'NOT_ROOM_OWNER');

        const invalid = await sendRequest(owner, {
            type: 'room.configure',
            request_id: 'invalid-configure',
            payload: { mode: 'deathmatch', notebooks_per_floor: 2 }
        });
        assert.equal(invalid.payload.code, 'INVALID_ROOM_SETTINGS');

        const guestUpdate = waitForMessage(guest, 'room.snapshot');
        const updated = await sendRequest(owner, {
            type: 'room.configure',
            request_id: 'owner-configure',
            payload: { name: 'After', mode: 'deathmatch', notebooks_per_floor: 1 }
        });
        const guestSnapshot = await guestUpdate;

        assert.equal(updated.type, 'room.snapshot');
        assert.equal(updated.request_id, 'owner-configure');
        assert.equal(updated.payload.revision, 3);
        assert.equal(updated.payload.room.name, 'After');
        assert.equal(updated.payload.room.mode, 'deathmatch');
        assert.equal(updated.payload.room.notebooks_per_floor, 1);
        assert.equal(guestSnapshot.payload.revision, 3);
        assert.equal(database.prepare('SELECT mode FROM rooms').get().mode, 'deathmatch');
    });

    it('allows only the owner to start after the catalog meets room requirements', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-startable-room',
            payload: {
                name: 'Startable',
                mode: 'classic',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;

        const insufficientPlayers = await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-without-players',
            payload: {}
        });
        assert.equal(insufficientPlayers.payload.code, 'INSUFFICIENT_PLAYERS');
        assert.equal(database.prepare('SELECT status FROM rooms').get().status, 'waiting');

        const guest = await connectClient();
        await hello(guest, '22222222-2222-4222-8222-222222222222');
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-startable-room',
            payload: { room_id: roomId }
        });

        const denied = await sendRequest(guest, {
            type: 'match.start',
            request_id: 'guest-start',
            payload: {}
        });
        assert.equal(denied.payload.code, 'NOT_ROOM_OWNER');

        const insufficient = await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-without-questions',
            payload: {}
        });
        assert.equal(insufficient.payload.code, 'INSUFFICIENT_QUESTIONS');
        assert.equal(database.prepare('SELECT status FROM rooms').get().status, 'waiting');
        assert.equal(server.presence.rooms.get(roomId).match, null);

        insertQuestions(3);
        const guestStarted = waitForMessage(guest, 'match.started');
        const guestSnapshot = waitForMessage(guest, 'room.snapshot');
        const started = await sendRequest(owner, {
            type: 'match.start',
            request_id: 'owner-start',
            payload: {}
        });

        assert.equal(started.type, 'match.started');
        assert.equal(started.request_id, 'owner-start');
        assert.equal(started.payload.room_id, created.payload.room.room_id);
        assert.equal((await guestStarted).type, 'match.started');
        assert.equal((await guestSnapshot).payload.room.status, 'playing');
        assert.equal(database.prepare('SELECT status FROM rooms').get().status, 'playing');

        const match = server.presence.rooms.get(roomId).match;
        assert.equal(match.floors.length, 3);
        assert.equal(match.questions.size, 3);
        assert.equal(match.players.size, 2);
        assert.equal(match.deadline, null);
        assert.equal(match.timeoutTimer, null);
        assert.equal(
            new Set(
                match.floors.flatMap(floor => floor.notebooks.map(notebook => notebook.questionId))
            ).size,
            3
        );

        const repeatedStart = await sendRequest(owner, {
            type: 'match.start',
            request_id: 'repeat-start',
            payload: {}
        });
        assert.equal(repeatedStart.payload.code, 'ROOM_IN_PROGRESS');
    });

    it('ends a timed match when its deadline timer fires', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-match-timeout',
            payload: {
                name: 'Timed match',
                mode: 'classic',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: 60,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;
        await joinGuest(roomId, 'join-room-for-match-timeout');
        insertQuestions(3);
        const endedPromise = waitForMessage(owner, 'match.ended');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-match-timeout',
            payload: {}
        });

        const match = server.presence.rooms.get(roomId).match;
        assert.equal(match.startedAt, now);
        assert.equal(match.deadline, now + 60_000);
        assert.equal(match.timeoutTimer.delay, 60_000);
        const earlyTimer = match.timeoutTimer;
        earlyTimer.callback();
        assert.notEqual(match.timeoutTimer, earlyTimer);
        assert.equal(match.timeoutTimer.delay, 60_000);
        now = match.deadline;
        match.timeoutTimer.callback();

        const ended = await endedPromise;
        assert.equal(ended.payload.reason, 'time_limit_reached');
        assert.equal(match.ended, true);
        assert.equal(match.timeoutTimer, null);
        assert.equal(server.presence.rooms.get(roomId).match, null);
        assert.equal(
            database.prepare('SELECT status FROM rooms WHERE id = ?').get(roomId).status,
            'waiting'
        );
    });

    it('gives timeout priority over an answer processed at the exact deadline', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-answer-deadline',
            payload: {
                name: 'Answer deadline',
                mode: 'classic',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: 60,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;
        await joinGuest(roomId, 'join-room-for-answer-deadline');
        insertQuestions(3);
        const questionPromise = waitForMessage(owner, 'question.presented');
        const endedPromise = waitForMessage(owner, 'match.ended');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-answer-deadline',
            payload: {}
        });
        const question = (await questionPromise).payload;
        const match = server.presence.rooms.get(roomId).match;
        now = match.deadline;

        const answer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'answer-at-deadline',
            payload: { question_id: question.question_id, option_index: 0 }
        });
        const ended = await endedPromise;

        assert.equal(answer.payload.code, 'ACTION_NOT_ALLOWED');
        assert.equal(ended.payload.reason, 'time_limit_reached');
        assert.equal(match.progress.get(playerId).floor, 1);
    });

    it('gives timeout priority over movement processed at the exact deadline', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-movement-deadline',
            payload: {
                name: 'Movement deadline',
                mode: 'classic',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: 60,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;
        await joinGuest(roomId, 'join-room-for-movement-deadline');
        insertQuestions(3);
        const endedPromise = waitForMessage(owner, 'match.ended');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-movement-deadline',
            payload: {}
        });
        const match = server.presence.rooms.get(roomId).match;
        now = match.deadline;

        const movement = await sendRequest(owner, {
            type: 'player.move',
            request_id: 'movement-at-deadline',
            payload: { sequence: 0, direction: 'east' }
        });
        const ended = await endedPromise;

        assert.equal(movement.payload.code, 'ACTION_NOT_ALLOWED');
        assert.equal(ended.payload.reason, 'time_limit_reached');
        assert.deepEqual(match.movement.get(playerId), {
            x: 50,
            y: 80,
            direction: 'stop',
            sequence: -1
        });
    });

    it('accepts a final answer before the deadline and ignores the later timeout callback', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-final-answer-race',
            payload: {
                name: 'Final answer race',
                mode: 'classic',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: 60,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;
        const guest = await joinGuest(roomId, 'join-room-for-final-answer-race');
        insertQuestions(3);
        const questionPromise = waitForMessage(owner, 'question.presented');
        const guestQuestionPromise = waitForMessage(guest, 'question.presented');
        const endedPromise = waitForMessage(owner, 'match.ended');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-final-answer-race',
            payload: {}
        });
        const match = server.presence.rooms.get(roomId).match;
        const timeoutTimer = match.timeoutTimer;
        let question = (await questionPromise).payload;
        let guestQuestion = (await guestQuestionPromise).payload;

        for (let floor = 1; floor <= 3; floor += 1) {
            if (floor === 3) now = match.deadline - 1;
            const nextQuestionPromise =
                floor < 3 ? waitForMessage(owner, 'question.presented') : null;
            const answer = await sendRequest(owner, {
                type: 'question.answer',
                request_id: `final-answer-race-${floor}`,
                payload: { question_id: question.question_id, option_index: 0 }
            });
            assert.equal(answer.payload.correct, true);
            if (nextQuestionPromise) {
                await walkThroughOpenDoor(owner, playerId, match, `race-owner-${floor}`);
                question = (await nextQuestionPromise).payload;
            } else {
                await walkThroughOpenDoor(owner, playerId, match, 'race-owner-final', true);
            }
        }

        for (let floor = 1; floor <= 3; floor += 1) {
            if (floor === 3) now = match.deadline - 1;
            const nextQuestionPromise =
                floor < 3 ? waitForMessage(guest, 'question.presented') : null;
            const answer = await sendRequest(guest, {
                type: 'question.answer',
                request_id: `guest-final-answer-race-${floor}`,
                payload: { question_id: guestQuestion.question_id, option_index: 0 }
            });
            assert.equal(answer.payload.correct, true);
            if (nextQuestionPromise) {
                await walkThroughOpenDoor(
                    guest,
                    '22222222-2222-4222-8222-222222222222',
                    match,
                    `race-guest-${floor}`
                );
                guestQuestion = (await nextQuestionPromise).payload;
            } else {
                await walkThroughOpenDoor(
                    guest,
                    '22222222-2222-4222-8222-222222222222',
                    match,
                    'race-guest-final',
                    true
                );
            }
        }

        const ended = await endedPromise;
        assert.equal(ended.payload.reason, 'all_players_finished');
        assert.equal(match.timeoutTimer, null);
        timeoutTimer.callback();
        assert.equal(match.endReason, 'all_players_finished');
    });

    it('ends an unlimited classic match when all floors are completed', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-classic-completion',
            payload: {
                name: 'Unlimited classic',
                mode: 'classic',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;
        const guest = await joinGuest(roomId, 'join-room-for-classic-completion');
        insertQuestions(3);
        const questionPromise = waitForMessage(owner, 'question.presented');
        const guestQuestionPromise = waitForMessage(guest, 'question.presented');
        const endedPromise = waitForMessage(owner, 'match.ended');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-classic-completion',
            payload: {}
        });
        let question = (await questionPromise).payload;
        let guestQuestion = (await guestQuestionPromise).payload;
        const match = server.presence.rooms.get(roomId).match;
        assert.equal(match.deadline, null);
        assert.equal(match.timeoutTimer, null);

        for (let floor = 1; floor <= 3; floor += 1) {
            const nextQuestionPromise =
                floor < 3 ? waitForMessage(owner, 'question.presented') : null;
            const answer = await sendRequest(owner, {
                type: 'question.answer',
                request_id: `classic-completion-${floor}`,
                payload: { question_id: question.question_id, option_index: 0 }
            });
            assert.equal(answer.payload.correct, true);
            if (nextQuestionPromise) {
                await walkThroughOpenDoor(owner, playerId, match, `completion-owner-${floor}`);
                question = (await nextQuestionPromise).payload;
            } else {
                await walkThroughOpenDoor(owner, playerId, match, 'completion-owner-final', true);
            }
        }

        for (let floor = 1; floor <= 3; floor += 1) {
            const nextQuestionPromise =
                floor < 3 ? waitForMessage(guest, 'question.presented') : null;
            const answer = await sendRequest(guest, {
                type: 'question.answer',
                request_id: `classic-guest-completion-${floor}`,
                payload: { question_id: guestQuestion.question_id, option_index: 0 }
            });
            assert.equal(answer.payload.correct, true);
            if (nextQuestionPromise) {
                await walkThroughOpenDoor(
                    guest,
                    '22222222-2222-4222-8222-222222222222',
                    match,
                    `completion-guest-${floor}`
                );
                guestQuestion = (await nextQuestionPromise).payload;
            } else {
                await walkThroughOpenDoor(
                    guest,
                    '22222222-2222-4222-8222-222222222222',
                    match,
                    'completion-guest-final',
                    true
                );
            }
        }

        const ended = await endedPromise;
        assert.equal(ended.payload.reason, 'all_players_finished');
        assert.equal(ended.payload.entries[0].status, 'finished');
        assert.equal(match.ended, true);
        assert.equal(match.timeoutTimer, null);
        assert.equal(server.presence.rooms.get(roomId).match, null);
        assert.equal(
            database.prepare('SELECT status FROM rooms WHERE id = ?').get(roomId).status,
            'waiting'
        );
    });

    it('broadcasts authoritative rankings with deterministic classic tie-breaks', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-live-ranking',
            payload: {
                name: 'Live ranking',
                mode: 'classic',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;

        const guest = await connectClient();
        const guestId = '22222222-2222-4222-8222-222222222222';
        await hello(guest, guestId);
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-room-for-live-ranking',
            payload: { room_id: roomId }
        });
        insertQuestions(3);

        const initialOwnerQuestion = waitForMessage(owner, 'question.presented');
        const initialGuestQuestion = waitForMessage(guest, 'question.presented');
        const initialOwnerRanking = waitForMessage(owner, 'ranking.updated');
        const initialGuestRanking = waitForMessage(guest, 'ranking.updated');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-live-ranking',
            payload: {}
        });
        let ownerQuestion = (await initialOwnerQuestion).payload;
        let guestQuestion = (await initialGuestQuestion).payload;
        assert.deepEqual(ownerQuestion.notebook_position, getNotebookTiles(1)[0]);
        assert.deepEqual(guestQuestion.notebook_position, getNotebookTiles(1)[0]);
        const initialRanking = (await initialOwnerRanking).payload;
        assert.deepEqual((await initialGuestRanking).payload, initialRanking);
        assert.equal(initialRanking.revision, 1);
        assert.deepEqual(
            initialRanking.entries.map(entry => entry.user_id),
            [playerId, guestId]
        );

        const ownerQuestionTwo = waitForMessage(owner, 'question.presented');
        const ownerRankingTwo = waitForMessage(owner, 'ranking.updated');
        const guestRankingTwo = waitForMessage(guest, 'ranking.updated');
        const ownerFloorSnapshot = waitForMessage(owner, 'match.snapshot', payload =>
            payload.players.some(player => player.user_id === playerId && player.floor === 2)
        );
        const guestFloorSnapshot = waitForMessage(
            guest,
            'match.snapshot',
            payload =>
                payload.players.some(player => player.user_id === guestId) &&
                !payload.players.some(player => player.user_id === playerId)
        );
        await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'owner-reaches-floor-two',
            payload: { question_id: ownerQuestion.question_id, option_index: 0 }
        });
        await walkThroughOpenDoor(
            owner,
            playerId,
            server.presence.rooms.get(roomId).match,
            'rank-owner-one'
        );
        ownerQuestion = (await ownerQuestionTwo).payload;
        const ownerSnapshot = (await ownerFloorSnapshot).payload;
        const guestSnapshot = (await guestFloorSnapshot).payload;
        const ownerOnNextFloor = ownerSnapshot.players.find(player => player.user_id === playerId);
        assert.deepEqual(
            ownerSnapshot.players.map(player => player.user_id),
            [playerId]
        );
        assert.equal(Math.floor(ownerOnNextFloor.x / (100 / 15)), 7);
        assert.equal(Math.floor(ownerOnNextFloor.y / (100 / 15)), 14);
        assert.equal(ownerOnNextFloor.floor, 2);
        assert.equal(ownerOnNextFloor.door_open, false);
        assert.deepEqual(
            guestSnapshot.players.map(player => player.user_id),
            [guestId]
        );
        assert.equal(
            guestSnapshot.players.some(player => player.floor !== 1),
            false
        );
        const ownerFloorMoves = [];
        const recordOwnerFloorMove = data => {
            const message = JSON.parse(data.toString('utf8'));
            if (
                message.type === 'player.moved' &&
                message.payload.user_id === playerId &&
                message.payload.floor === 2
            ) {
                ownerFloorMoves.push(message.payload);
            }
        };
        guest.on('message', recordOwnerFloorMove);
        const match = server.presence.rooms.get(roomId).match;
        const nextSequence = match.movement.get(playerId).sequence + 1;
        const ownerMovement = waitForMessage(
            owner,
            'player.moved',
            payload => payload.user_id === playerId && payload.sequence === nextSequence
        );
        owner.send(
            JSON.stringify({
                type: 'player.move',
                payload: { sequence: nextSequence, direction: 'east' }
            })
        );
        await ownerMovement;
        await new Promise(resolve => setTimeout(resolve, 10));
        guest.off('message', recordOwnerFloorMove);
        assert.deepEqual(ownerFloorMoves, []);
        const ownerAheadRanking = (await ownerRankingTwo).payload;
        assert.deepEqual((await guestRankingTwo).payload, ownerAheadRanking);
        assert.deepEqual(
            ownerAheadRanking.entries.map(entry => entry.user_id),
            [playerId, guestId]
        );

        const guestQuestionTwo = waitForMessage(guest, 'question.presented');
        const ownerRankingThree = waitForMessage(owner, 'ranking.updated');
        const guestRankingThree = waitForMessage(guest, 'ranking.updated');
        const sameFloorSnapshot = waitForMessage(
            guest,
            'match.snapshot',
            payload =>
                payload.players.some(player => player.user_id === playerId) &&
                payload.players.some(player => player.user_id === guestId)
        );
        await sendRequest(guest, {
            type: 'question.answer',
            request_id: 'guest-reaches-floor-two',
            payload: { question_id: guestQuestion.question_id, option_index: 0 }
        });
        await walkThroughOpenDoor(
            guest,
            guestId,
            server.presence.rooms.get(roomId).match,
            'rank-guest-one'
        );
        guestQuestion = (await guestQuestionTwo).payload;
        await sameFloorSnapshot;
        const tiedRanking = (await ownerRankingThree).payload;
        assert.deepEqual((await guestRankingThree).payload, tiedRanking);
        assert.equal(tiedRanking.revision, 3);
        assert.deepEqual(
            tiedRanking.entries.map(entry => entry.user_id),
            [playerId, guestId]
        );

        const forgedScore = await sendRequest(owner, {
            type: 'ranking.updated',
            request_id: 'client-forged-ranking',
            payload: { score: 1000, rank: 1 }
        });
        assert.equal(forgedScore.type, 'error');
        assert.equal(forgedScore.payload.code, 'INVALID_MESSAGE');
        assert.equal(server.presence.rooms.get(roomId).match.rankingRevision, 3);

        const ownerQuestionThree = waitForMessage(owner, 'question.presented');
        const ownerRankingFour = waitForMessage(owner, 'ranking.updated');
        const guestRankingFour = waitForMessage(guest, 'ranking.updated');
        await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'owner-reaches-final-floor',
            payload: { question_id: ownerQuestion.question_id, option_index: 0 }
        });
        await walkThroughOpenDoor(
            owner,
            playerId,
            server.presence.rooms.get(roomId).match,
            'rank-owner-two'
        );
        ownerQuestion = (await ownerQuestionThree).payload;
        const finalFloorRanking = (await ownerRankingFour).payload;
        assert.deepEqual((await guestRankingFour).payload, finalFloorRanking);
        assert.equal(finalFloorRanking.entries[0].user_id, playerId);

        const ownerRankingFive = waitForMessage(owner, 'ranking.updated');
        const guestRankingFive = waitForMessage(guest, 'ranking.updated');
        const ownerSpectatorStarted = waitForMessage(
            owner,
            'spectator.started',
            payload => payload.reason === 'run_finished'
        );
        await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'owner-finishes-first',
            payload: { question_id: ownerQuestion.question_id, option_index: 0 }
        });
        await walkThroughOpenDoor(
            owner,
            playerId,
            server.presence.rooms.get(roomId).match,
            'rank-owner-final',
            true
        );
        assert.equal((await ownerSpectatorStarted).payload.target_user_id, guestId);
        const ownerFinishedRanking = (await ownerRankingFive).payload;
        assert.deepEqual((await guestRankingFive).payload, ownerFinishedRanking);
        assert.equal(ownerFinishedRanking.entries[0].user_id, playerId);
        assert.equal(ownerFinishedRanking.entries[0].status, 'finished');

        const guestQuestionThree = waitForMessage(guest, 'question.presented');
        const ownerRankingSix = waitForMessage(owner, 'ranking.updated');
        const guestRankingSix = waitForMessage(guest, 'ranking.updated');
        await sendRequest(guest, {
            type: 'question.answer',
            request_id: 'guest-reaches-final-floor',
            payload: { question_id: guestQuestion.question_id, option_index: 0 }
        });
        await walkThroughOpenDoor(
            guest,
            guestId,
            server.presence.rooms.get(roomId).match,
            'rank-guest-two'
        );
        guestQuestion = (await guestQuestionThree).payload;
        assert.equal((await ownerRankingSix).payload.entries[0].user_id, playerId);
        await guestRankingSix;

        const ownerEnded = waitForMessage(owner, 'match.ended');
        const guestEnded = waitForMessage(guest, 'match.ended');
        const guestSpectatorStarted = waitForMessage(
            guest,
            'spectator.started',
            payload => payload.reason === 'run_finished'
        );
        await sendRequest(guest, {
            type: 'question.answer',
            request_id: 'guest-finishes-after-owner',
            payload: { question_id: guestQuestion.question_id, option_index: 0 }
        });
        await walkThroughOpenDoor(
            guest,
            guestId,
            server.presence.rooms.get(roomId).match,
            'rank-guest-final',
            true
        );
        assert.equal((await guestSpectatorStarted).payload.target_user_id, null);
        const ownerResult = await ownerEnded;
        const guestResult = await guestEnded;
        assert.deepEqual(
            ownerResult.payload.entries.map(entry => entry.user_id),
            [playerId, guestId]
        );
        assert.deepEqual(ownerResult, guestResult);
    });

    it('synchronizes authoritative movement and rejects stale or malformed input', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-movement',
            payload: {
                name: 'Movement',
                mode: 'classic',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;

        const guest = await connectClient();
        const guestId = '22222222-2222-4222-8222-222222222222';
        await hello(guest, guestId);
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-room-for-movement',
            payload: { room_id: roomId }
        });
        insertQuestions(3);
        const ownerSnapshot = waitForMessage(owner, 'match.snapshot');
        const guestSnapshot = waitForMessage(guest, 'match.snapshot');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-movement',
            payload: {}
        });
        const [ownerMatchSnapshot, guestMatchSnapshot] = await Promise.all([
            ownerSnapshot,
            guestSnapshot
        ]);
        assert.deepEqual(ownerMatchSnapshot.payload.viewer, {
            status: 'playing',
            target_user_id: null
        });
        assert.deepEqual(guestMatchSnapshot.payload.viewer, {
            status: 'playing',
            target_user_id: null
        });
        for (const snapshot of [ownerMatchSnapshot, guestMatchSnapshot]) {
            assert.deepEqual(
                snapshot.payload.players.map(player => ({
                    user_id: player.user_id,
                    nickname: player.nickname,
                    character_id: player.character_id
                })),
                [
                    {
                        user_id: playerId,
                        nickname: 'Player One',
                        character_id: 'avatar-1'
                    },
                    {
                        user_id: guestId,
                        nickname: 'Player One',
                        character_id: 'avatar-1'
                    }
                ]
            );
        }

        const ownerMoved = waitForMessage(owner, 'player.moved');
        const guestMoved = waitForMessage(guest, 'player.moved');
        owner.send(
            JSON.stringify({
                type: 'player.move',
                payload: { sequence: 0, direction: 'east' }
            })
        );
        const ownerUpdate = await ownerMoved;
        const guestUpdate = await guestMoved;
        assert.deepEqual(ownerUpdate, guestUpdate);
        assert.deepEqual(ownerUpdate.payload, {
            revision: 1,
            user_id: playerId,
            nickname: 'Player One',
            character_id: 'avatar-1',
            sequence: 0,
            direction: 'east',
            x: 52.5,
            y: 80,
            floor: 1,
            door_open: false
        });

        const stale = await sendRequest(owner, {
            type: 'player.move',
            request_id: 'stale-movement',
            payload: { sequence: 0, direction: 'north' }
        });
        assert.equal(stale.payload.code, 'STALE_INPUT');

        const invalid = await sendRequest(owner, {
            type: 'player.move',
            request_id: 'invalid-movement',
            payload: { sequence: 1, direction: 'up' }
        });
        assert.equal(invalid.payload.code, 'INVALID_MESSAGE');

        const forgedCoordinates = await sendRequest(owner, {
            type: 'player.move',
            request_id: 'forged-movement-coordinates',
            payload: { sequence: 1, direction: 'east', x: 100, y: 100 }
        });
        assert.equal(forgedCoordinates.payload.code, 'INVALID_MESSAGE');
        assert.equal(server.presence.rooms.get(roomId).match.movement.get(playerId).x, 52.5);
    });

    it('advances classic players and opens the next floor after the door wait', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-classic-progression',
            payload: {
                name: 'Classic progression',
                mode: 'classic',
                floors: 3,
                notebooks_per_floor: 2,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;
        await joinGuest(roomId, 'join-classic-progression');
        insertQuestions(6);

        const initialQuestionPromise = waitForMessage(
            owner,
            'question.presented',
            payload => payload.notebook_label === 1
        );
        const otherInitialQuestionPromise = waitForMessage(
            owner,
            'question.presented',
            payload => payload.notebook_label === 2
        );
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-classic-progression',
            payload: {}
        });
        const firstQuestion = (await initialQuestionPromise).payload;
        const secondQuestion = (await otherInitialQuestionPromise).payload;
        assert.equal(firstQuestion.floor, 1);
        assert.equal(secondQuestion.floor, 1);
        assert.notEqual(secondQuestion.question_id, firstQuestion.question_id);
        assert.equal('correct_option_index' in firstQuestion, false);
        assert.equal('explanation' in firstQuestion, false);

        const firstWrongAnswer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-first-wrong',
            payload: { question_id: secondQuestion.question_id, option_index: 1 }
        });
        assert.equal(firstWrongAnswer.payload.correct, false);
        assert.equal(firstWrongAnswer.payload.correct_option_index, 0);
        assert.equal(firstWrongAnswer.payload.notebook_id, secondQuestion.notebook_id);
        assert.equal(secondQuestion.floor, 1);
        assert.notEqual(secondQuestion.question_id, firstQuestion.question_id);
        assert.equal('retry_after_ms' in firstWrongAnswer.payload, false);
        assert.equal(
            server.presence.rooms.get(roomId).match.progress.get(playerId).status,
            'playing'
        );
        assert.equal(
            disconnectTimers.some(timer => timer.delay === 5000 && !timer.cleared),
            false
        );

        const duplicateAnswer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-duplicate-wrong-notebook',
            payload: { question_id: secondQuestion.question_id, option_index: 0 }
        });
        assert.equal(duplicateAnswer.payload.code, 'INVALID_ANSWER');

        const lastWrongAnswer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-last-wrong',
            payload: { question_id: firstQuestion.question_id, option_index: 1 }
        });
        assert.equal(lastWrongAnswer.payload.correct, false);
        assert.equal(lastWrongAnswer.payload.retry_after_ms, 5000);
        assert.equal(
            server.presence.rooms.get(roomId).match.progress.get(playerId).status,
            'cooldown'
        );

        const duringCooldown = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-answer-during-cooldown',
            payload: { question_id: secondQuestion.question_id, option_index: 0 }
        });
        assert.equal(duringCooldown.payload.code, 'ACTION_NOT_ALLOWED');

        const doorTimer = [...disconnectTimers]
            .reverse()
            .find(timer => timer.delay === 5000 && !timer.cleared);
        assert.ok(doorTimer);
        const doorOpenedPromise = waitForMessage(owner, 'door.opened');
        doorTimer.callback();
        const doorOpened = await doorOpenedPromise;
        assert.equal(doorOpened.payload.floor, 1);
        assert.equal(doorOpened.payload.reason, 'all_notebooks_answered');
        const match = server.presence.rooms.get(roomId).match;
        assert.equal(match.progress.get(playerId).floor, 1);
        assert.equal(match.progress.get(playerId).doorOpen, true);
        assert.equal(match.progress.get(playerId).answeredNotebooks.length, 2);

        const floorTwoQuestionPromise = waitForMessage(
            owner,
            'question.presented',
            payload => payload.notebook_label === 1 && payload.floor === 2
        );
        const floorTwoNotebookPromise = waitForMessage(
            owner,
            'question.presented',
            payload => payload.notebook_label === 2 && payload.floor === 2
        );
        await walkThroughOpenDoor(owner, playerId, match, 'classic-floor-one');
        const floorTwoQuestion = (await floorTwoQuestionPromise).payload;
        assert.equal(floorTwoQuestion.floor, 2);
        const floorTwoNotebook = (await floorTwoNotebookPromise).payload;

        const floorTwoCorrectAnswer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-floor-two-notebook-two-correct',
            payload: { question_id: floorTwoNotebook.question_id, option_index: 0 }
        });
        assert.equal(floorTwoCorrectAnswer.payload.correct, true);
        assert.equal(floorTwoCorrectAnswer.payload.door_open, true);
        assert.equal(match.progress.get(playerId).floor, 2);
        const answerAfterCorrect = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-answer-after-door-open',
            payload: { question_id: floorTwoQuestion.question_id, option_index: 0 }
        });
        assert.equal(answerAfterCorrect.payload.code, 'ACTION_NOT_ALLOWED');
        const floorThreeQuestionPromise = waitForMessage(owner, 'question.presented');
        await walkThroughOpenDoor(owner, playerId, match, 'classic-floor-two');
        const floorThreeQuestion = (await floorThreeQuestionPromise).payload;
        assert.equal(floorThreeQuestion.floor, 3);
    });

    it('eliminates deathmatch players on a wrong answer and ends for the last standing', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-deathmatch-elimination',
            payload: {
                name: 'Deathmatch elimination',
                mode: 'deathmatch',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;

        const guest = await connectClient();
        const guestId = '22222222-2222-4222-8222-222222222222';
        await hello(guest, guestId);
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-deathmatch-elimination',
            payload: { room_id: roomId }
        });
        insertQuestions(3);

        const ownerQuestionPromise = waitForMessage(owner, 'question.presented');
        const guestQuestionPromise = waitForMessage(guest, 'question.presented');
        const ownerInitialRanking = waitForMessage(owner, 'ranking.updated');
        const guestInitialRanking = waitForMessage(guest, 'ranking.updated');
        const eliminatedPromise = waitForMessage(guest, 'player.eliminated');
        const spectatorPromise = waitForMessage(owner, 'spectator.started');
        const ownerEndedPromise = waitForMessage(owner, 'match.ended');
        const guestEndedPromise = waitForMessage(guest, 'match.ended');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-deathmatch-elimination',
            payload: {}
        });
        const match = server.presence.rooms.get(roomId).match;
        const ownerQuestion = (await ownerQuestionPromise).payload;
        await guestQuestionPromise;
        assert.deepEqual((await ownerInitialRanking).payload, (await guestInitialRanking).payload);

        const ownerEliminationRanking = waitForMessage(owner, 'ranking.updated');
        const guestEliminationRanking = waitForMessage(guest, 'ranking.updated');
        const wrongAnswer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'deathmatch-wrong-answer',
            payload: { question_id: ownerQuestion.question_id, option_index: 1 }
        });
        const eliminated = await eliminatedPromise;
        const spectator = await spectatorPromise;
        const ranking = (await ownerEliminationRanking).payload;
        assert.deepEqual((await guestEliminationRanking).payload, ranking);
        assert.deepEqual(
            ranking.entries.map(entry => entry.user_id),
            [playerId, guestId]
        );
        assert.equal(ranking.entries[0].status, 'eliminated');
        assert.equal(ranking.entries[1].status, 'playing');
        const ownerEnded = await ownerEndedPromise;
        const guestEnded = await guestEndedPromise;

        assert.equal(wrongAnswer.payload.correct, false);
        assert.equal(eliminated.payload.user_id, playerId);
        assert.equal(eliminated.payload.reason, 'wrong_answer');
        assert.equal(spectator.payload.target_user_id, guestId);
        assert.equal(ownerEnded.payload.reason, 'last_player_standing');
        assert.deepEqual(
            ownerEnded.payload.entries.slice(0, 2).map(entry => entry.user_id),
            [playerId, guestId]
        );
        assert.deepEqual(ownerEnded, guestEnded);
        assert.equal(match.winnerUserId, guestId);
        assert.equal(server.presence.rooms.get(roomId).match, null);
        assert.equal(
            database.prepare('SELECT status FROM rooms WHERE id = ?').get(roomId).status,
            'waiting'
        );

        const afterEnd = await sendRequest(guest, {
            type: 'question.answer',
            request_id: 'deathmatch-answer-after-end',
            payload: {
                question_id: (await guestQuestionPromise).payload.question_id,
                option_index: 0
            }
        });
        assert.equal(afterEnd.payload.code, 'ACTION_NOT_ALLOWED');

        const movementAfterEnd = await sendRequest(guest, {
            type: 'player.move',
            request_id: 'deathmatch-movement-after-end',
            payload: { sequence: 0, direction: 'east' }
        });
        assert.equal(movementAfterEnd.payload.code, 'ACTION_NOT_ALLOWED');
    });

    it('moves completed deathmatch runs to spectating while other players continue', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-deathmatch-question-end',
            payload: {
                name: 'Deathmatch questions',
                mode: 'deathmatch',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;
        const guest = await connectClient();
        const guestId = '22222222-2222-4222-8222-222222222222';
        await hello(guest, guestId);
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-deathmatch-question-end',
            payload: { room_id: roomId }
        });
        insertQuestions(3);

        const questionPromise = waitForMessage(owner, 'question.presented');
        const guestQuestionPromise = waitForMessage(guest, 'question.presented');
        const ownerEndedPromise = waitForMessage(owner, 'match.ended');
        const guestEndedPromise = waitForMessage(guest, 'match.ended');
        const ownerSpectatorStarted = waitForMessage(
            owner,
            'spectator.started',
            payload => payload.reason === 'run_finished'
        );
        const ownerSpectatorSnapshot = waitForMessage(
            owner,
            'match.snapshot',
            payload => payload.viewer?.status === 'finished'
        );
        const guestSpectatorStarted = waitForMessage(
            guest,
            'spectator.started',
            payload => payload.reason === 'run_finished'
        );
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-deathmatch-question-end',
            payload: {}
        });
        const match = server.presence.rooms.get(roomId).match;
        let question = (await questionPromise).payload;
        let guestQuestion = (await guestQuestionPromise).payload;

        for (let floor = 1; floor <= 3; floor += 1) {
            const nextQuestionPromise =
                floor < 3 ? waitForMessage(owner, 'question.presented') : null;
            const answer = await sendRequest(owner, {
                type: 'question.answer',
                request_id: `deathmatch-correct-${floor}`,
                payload: { question_id: question.question_id, option_index: 0 }
            });
            assert.equal(answer.payload.correct, true);
            if (nextQuestionPromise) {
                await walkThroughOpenDoor(owner, playerId, match, `deathmatch-floor-${floor}`);
                question = (await nextQuestionPromise).payload;
                assert.equal(question.floor, floor + 1);
            } else {
                await walkThroughOpenDoor(owner, playerId, match, 'deathmatch-owner-final', true);
            }
        }

        assert.equal((await ownerSpectatorStarted).payload.target_user_id, guestId);
        const spectatorSnapshot = (await ownerSpectatorSnapshot).payload;
        assert.equal(spectatorSnapshot.viewer.target_user_id, guestId);
        assert.equal(
            spectatorSnapshot.players.some(player => player.user_id === playerId),
            false
        );
        assert.equal(server.presence.players.get(playerId).status, 'spectating');
        assert.equal(match.ended, false);
        const spectatorMove = await sendRequest(owner, {
            type: 'player.move',
            request_id: 'finished-run-movement-denied',
            payload: { sequence: 0, direction: 'east' }
        });
        assert.equal(spectatorMove.payload.code, 'FORBIDDEN_ROLE');

        for (let floor = 1; floor <= 3; floor += 1) {
            const nextQuestionPromise =
                floor < 3 ? waitForMessage(guest, 'question.presented') : null;
            const answer = await sendRequest(guest, {
                type: 'question.answer',
                request_id: `deathmatch-guest-correct-${floor}`,
                payload: { question_id: guestQuestion.question_id, option_index: 0 }
            });
            assert.equal(answer.payload.correct, true);
            if (nextQuestionPromise) {
                await walkThroughOpenDoor(guest, guestId, match, `deathmatch-guest-floor-${floor}`);
                guestQuestion = (await nextQuestionPromise).payload;
            } else {
                await walkThroughOpenDoor(guest, guestId, match, 'deathmatch-guest-final', true);
            }
        }

        assert.equal((await guestSpectatorStarted).payload.target_user_id, null);
        const ownerEnded = await ownerEndedPromise;
        const guestEnded = await guestEndedPromise;
        assert.equal(ownerEnded.payload.reason, 'questions_exhausted');
        assert.equal(ownerEnded.payload.entries[0].user_id, playerId);
        assert.deepEqual(ownerEnded, guestEnded);
        assert.equal(match.winnerUserId, playerId);
        assert.equal(server.presence.rooms.get(roomId).match, null);
    });

    it('rejects a single-player deathmatch', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-solo-deathmatch',
            payload: {
                name: 'Solo deathmatch',
                mode: 'deathmatch',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 1
            }
        });
        const roomId = created.payload.room.room_id;
        insertQuestions(3);

        const rejected = await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-solo-deathmatch',
            payload: {}
        });

        assert.equal(rejected.payload.code, 'INSUFFICIENT_PLAYERS');
        assert.equal(server.presence.rooms.get(roomId).match, null);
        assert.equal(
            database.prepare('SELECT status FROM rooms WHERE id = ?').get(roomId).status,
            'waiting'
        );
    });

    it('returns everyone to the lobby and allows the owner to start a rematch', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-rematch',
            payload: {
                name: 'Rematch',
                mode: 'deathmatch',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;

        const guest = await connectClient();
        const guestId = '22222222-2222-4222-8222-222222222222';
        await hello(guest, guestId);
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-room-for-rematch',
            payload: { room_id: roomId }
        });
        insertQuestions(3);

        const ownerQuestionPromise = waitForMessage(owner, 'question.presented');
        const guestQuestionPromise = waitForMessage(guest, 'question.presented');
        const ownerEndedPromise = waitForMessage(owner, 'match.ended');
        const guestEndedPromise = waitForMessage(guest, 'match.ended');
        const ownerLobbyPromise = waitForMessage(
            owner,
            'room.snapshot',
            payload => payload.room.status === 'waiting'
        );
        const guestLobbyPromise = waitForMessage(
            guest,
            'room.snapshot',
            payload => payload.room.status === 'waiting'
        );
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-first-rematch-match',
            payload: {}
        });
        const firstOwnerQuestion = (await ownerQuestionPromise).payload;
        await guestQuestionPromise;
        const firstMatch = server.presence.rooms.get(roomId).match;

        await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'owner-eliminated-before-rematch',
            payload: { question_id: firstOwnerQuestion.question_id, option_index: 1 }
        });
        assert.equal((await ownerEndedPromise).payload.reason, 'last_player_standing');
        assert.equal((await guestEndedPromise).payload.reason, 'last_player_standing');
        const ownerLobby = await ownerLobbyPromise;
        const guestLobby = await guestLobbyPromise;

        assert.deepEqual(ownerLobby.payload, guestLobby.payload);
        assert.equal(ownerLobby.payload.room.owner_id, playerId);
        assert.equal(
            database.prepare('SELECT status FROM rooms WHERE id = ?').get(roomId).status,
            'waiting'
        );
        assert.equal(server.presence.rooms.get(roomId).match, null);
        assert.deepEqual(server.presence.rooms.get(roomId).spectatorIds, new Set());
        assert.equal(server.presence.players.get(playerId).status, 'active');
        assert.equal(server.presence.players.get(playerId).targetUserId, null);
        assert.equal(server.presence.players.get(guestId).status, 'active');

        const rematchOwnerQuestion = waitForMessage(owner, 'question.presented');
        const rematchGuestQuestion = waitForMessage(guest, 'question.presented');
        const rematch = await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-second-rematch-match',
            payload: {}
        });
        assert.equal(rematch.type, 'match.started');
        await rematchOwnerQuestion;
        await rematchGuestQuestion;
        assert.notEqual(server.presence.rooms.get(roomId).match, firstMatch);
        assert.equal(
            database.prepare('SELECT status FROM rooms WHERE id = ?').get(roomId).status,
            'playing'
        );
    });

    it('declares the last expired deathmatch player the winner', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-deathmatch-last-disconnected',
            payload: {
                name: 'Last disconnected',
                mode: 'deathmatch',
                floors: 3,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;
        const guest = await connectClient();
        const guestId = '22222222-2222-4222-8222-222222222222';
        await hello(guest, guestId);
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-deathmatch-last-disconnected',
            payload: { room_id: roomId }
        });
        insertQuestions(3);
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-deathmatch-last-disconnected',
            payload: {}
        });
        const match = server.presence.rooms.get(roomId).match;

        const ownerSocket = server.presence.connections.get(playerId);
        const guestSocket = server.presence.connections.get(guestId);
        const ownerClosed = once(ownerSocket, 'close');
        owner.close();
        await ownerClosed;
        const guestClosed = once(guestSocket, 'close');
        guest.close();
        await guestClosed;
        const [ownerTimer, guestTimer] = disconnectTimers.filter(
            timer => timer.delay === 30_000 && !timer.cleared
        );

        ownerTimer.callback();
        assert.equal(server.presence.rooms.get(roomId).match.ended, false);
        guestTimer.callback();

        assert.equal(match.ended, true);
        assert.equal(match.endReason, 'last_player_disconnected');
        assert.equal(match.winnerUserId, guestId);
        assert.equal(server.presence.rooms.get(roomId).match, null);
        assert.equal(server.presence.players.get(guestId).status, 'active');
        assert.equal(server.presence.players.get(guestId).targetUserId, null);
    });

    it('transfers ownership on leave and deletes the room after its final player leaves', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-handoff',
            payload: {
                name: 'Handoff',
                mode: 'classic',
                floors: 5,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 3
            }
        });
        const roomId = created.payload.room.room_id;

        const firstGuest = await connectClient();
        const firstGuestId = '22222222-2222-4222-8222-222222222222';
        await hello(firstGuest, firstGuestId);
        await sendRequest(firstGuest, {
            type: 'room.join',
            request_id: 'join-for-handoff',
            payload: { room_id: roomId }
        });

        const secondGuest = await connectClient();
        const secondGuestId = '33333333-3333-4333-8333-333333333333';
        await hello(secondGuest, secondGuestId);
        await sendRequest(secondGuest, {
            type: 'room.join',
            request_id: 'join-for-second-handoff',
            payload: { room_id: roomId }
        });

        const firstHandoff = waitForMessage(firstGuest, 'room.snapshot');
        const secondGuestFirstSnapshot = waitForMessage(secondGuest, 'room.snapshot');
        const ownerLeft = await sendRequest(owner, {
            type: 'room.leave',
            request_id: 'owner-leaves',
            payload: {}
        });
        const firstHandoffSnapshot = await firstHandoff;
        await secondGuestFirstSnapshot;
        assert.equal(ownerLeft.type, 'room.left');
        assert.equal(firstHandoffSnapshot.payload.room.owner_id, firstGuestId);
        assert.equal(database.prepare('SELECT owner_id FROM rooms').get().owner_id, firstGuestId);

        const secondHandoff = waitForMessage(secondGuest, 'room.snapshot');
        await sendRequest(firstGuest, {
            type: 'room.leave',
            request_id: 'first-owner-leaves',
            payload: {}
        });
        assert.equal((await secondHandoff).payload.room.owner_id, secondGuestId);

        const finalLeave = await sendRequest(secondGuest, {
            type: 'room.leave',
            request_id: 'final-player-leaves',
            payload: {}
        });
        assert.equal(finalLeave.type, 'room.left');
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rooms').get().count, 0);
        assert.equal(server.presence.rooms.has(roomId), false);
        assert.equal(server.presence.players.get(secondGuestId).roomId, null);
    });

    it('hands off the owner and removes expired lobby members', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-disconnect-handoff',
            payload: {
                name: 'Disconnect handoff',
                mode: 'classic',
                floors: 5,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;

        const guest = await connectClient();
        const guestId = '22222222-2222-4222-8222-222222222222';
        await hello(guest, guestId);
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-for-disconnect-handoff',
            payload: { room_id: roomId }
        });

        const disconnectSnapshot = waitForMessage(guest, 'room.snapshot');
        const ownerSocket = server.presence.connections.get(playerId);
        const ownerSocketClosed = once(ownerSocket, 'close');
        owner.close();
        await ownerSocketClosed;
        await disconnectSnapshot;
        const guestUpdate = waitForMessage(guest, 'room.snapshot');
        const ownerTimer = disconnectTimers.find(timer => !timer.cleared);
        assert.equal(ownerTimer.delay, 30_000);
        ownerTimer.callback();

        const snapshot = await guestUpdate;
        assert.equal(snapshot.payload.room.owner_id, guestId);
        assert.deepEqual(
            snapshot.payload.participants.map(participant => participant.user_id),
            [guestId]
        );
        assert.equal(database.prepare('SELECT owner_id FROM rooms').get().owner_id, guestId);
        assert.equal(server.presence.players.get(playerId).roomId, null);
    });

    it('deletes an empty room when its last disconnected player expires', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-empty-cleanup',
            payload: {
                name: 'Empty after timeout',
                mode: 'classic',
                floors: 5,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;

        const ownerSocket = server.presence.connections.get(playerId);
        const ownerSocketClosed = once(ownerSocket, 'close');
        owner.close();
        await ownerSocketClosed;
        disconnectTimers.find(timer => !timer.cleared).callback();

        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rooms').get().count, 0);
        assert.equal(server.presence.rooms.has(roomId), false);
        assert.equal(server.presence.players.get(playerId).roomId, null);
    });

    it('transfers an expired deathmatch owner and returns the match to the lobby', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-deathmatch-for-handoff',
            payload: {
                name: 'Deathmatch handoff',
                mode: 'deathmatch',
                floors: 5,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 2
            }
        });
        const roomId = created.payload.room.room_id;

        const guest = await connectClient();
        const guestId = '22222222-2222-4222-8222-222222222222';
        await hello(guest, guestId);
        await sendRequest(guest, {
            type: 'room.join',
            request_id: 'join-deathmatch-for-handoff',
            payload: { room_id: roomId }
        });
        insertQuestions(5);
        const matchSnapshot = waitForMessage(guest, 'room.snapshot');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-spectator-movement',
            payload: {}
        });
        await matchSnapshot;
        const match = server.presence.rooms.get(roomId).match;

        const disconnectSnapshot = waitForMessage(guest, 'room.snapshot');
        const ownerSocket = server.presence.connections.get(playerId);
        const ownerSocketClosed = once(ownerSocket, 'close');
        owner.close();
        await ownerSocketClosed;
        await disconnectSnapshot;
        const guestUpdate = waitForMessage(guest, 'room.snapshot');
        const matchEnded = waitForMessage(guest, 'match.ended');
        disconnectTimers.find(timer => !timer.cleared).callback();

        const snapshot = await guestUpdate;
        assert.equal((await matchEnded).payload.reason, 'last_player_standing');
        assert.equal(snapshot.payload.room.status, 'waiting');
        assert.equal(snapshot.payload.room.owner_id, guestId);
        assert.deepEqual(
            snapshot.payload.participants.map(participant => participant.user_id),
            [playerId, guestId]
        );
        const disconnectedOwner = server.presence.players.get(playerId);
        assert.equal(disconnectedOwner.roomId, roomId);
        assert.equal(disconnectedOwner.status, 'active');
        assert.equal(disconnectedOwner.targetUserId, null);
        assert.equal(match.ended, true);
        assert.equal(server.presence.rooms.get(roomId).match, null);
        assert.equal(
            database.prepare('SELECT status FROM rooms WHERE id = ?').get(roomId).status,
            'waiting'
        );
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rooms').get().count, 1);
    });

    it('eliminates deathmatch players into spectators and restricts their field of view', async () => {
        const owner = await connectClient();
        await hello(owner);
        const created = await sendRequest(owner, {
            type: 'room.create',
            request_id: 'create-room-for-spectators',
            payload: {
                name: 'Spectators',
                mode: 'deathmatch',
                floors: 5,
                notebooks_per_floor: 1,
                time_limit_seconds: null,
                max_players: 4
            }
        });
        const roomId = created.payload.room.room_id;

        const firstGuest = await connectClient();
        const firstGuestId = '22222222-2222-4222-8222-222222222222';
        await hello(firstGuest, firstGuestId);
        await sendRequest(firstGuest, {
            type: 'room.join',
            request_id: 'join-first-spectator-room',
            payload: { room_id: roomId }
        });

        const secondGuest = await connectClient();
        const secondGuestId = '33333333-3333-4333-8333-333333333333';
        await hello(secondGuest, secondGuestId);
        await sendRequest(secondGuest, {
            type: 'room.join',
            request_id: 'join-second-spectator-room',
            payload: { room_id: roomId }
        });
        insertQuestions(5);
        const ownerInitialRanking = waitForMessage(owner, 'ranking.updated');
        const firstInitialRanking = waitForMessage(firstGuest, 'ranking.updated');
        const secondInitialRanking = waitForMessage(secondGuest, 'ranking.updated');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-spectator-movement',
            payload: {}
        });
        const initialRanking = (await ownerInitialRanking).payload;
        assert.deepEqual((await firstInitialRanking).payload, initialRanking);
        assert.deepEqual((await secondInitialRanking).payload, initialRanking);

        const activeFollow = await sendRequest(owner, {
            type: 'spectator.follow',
            request_id: 'active-follow',
            payload: { target_user_id: firstGuestId }
        });
        assert.equal(activeFollow.payload.code, 'ACTION_NOT_ALLOWED');

        const eliminatedEvent = waitForMessage(owner, 'player.eliminated');
        const spectatorStarted = waitForMessage(firstGuest, 'spectator.started');
        const ownerFirstEliminationRanking = waitForMessage(owner, 'ranking.updated');
        const firstFirstEliminationRanking = waitForMessage(firstGuest, 'ranking.updated');
        const secondFirstEliminationRanking = waitForMessage(secondGuest, 'ranking.updated');
        const converted = eliminatePlayer({
            database,
            presence: server.presence,
            roomId,
            userId: firstGuestId
        });
        assert.deepEqual(converted, { userId: firstGuestId, targetUserId: playerId });
        assert.equal((await eliminatedEvent).payload.user_id, firstGuestId);
        assert.equal((await spectatorStarted).payload.target_user_id, playerId);
        const firstEliminationRanking = (await ownerFirstEliminationRanking).payload;
        assert.deepEqual((await firstFirstEliminationRanking).payload, firstEliminationRanking);
        assert.deepEqual((await secondFirstEliminationRanking).payload, firstEliminationRanking);
        assert.deepEqual(
            firstEliminationRanking.entries.map(entry => entry.user_id),
            [playerId, firstGuestId, secondGuestId]
        );

        const followedSnapshotPromise = waitForMessage(
            firstGuest,
            'match.snapshot',
            payload => payload.viewer?.target_user_id === secondGuestId
        );
        const follow = await sendRequest(firstGuest, {
            type: 'spectator.follow',
            request_id: 'spectator-follows-second-guest',
            payload: { target_user_id: secondGuestId }
        });
        const followedSnapshot = await followedSnapshotPromise;
        assert.equal(follow.type, 'spectator.following');
        assert.equal(follow.request_id, 'spectator-follows-second-guest');
        assert.equal(follow.payload.target_user_id, secondGuestId);
        assert.equal(followedSnapshot.payload.viewer.status, 'eliminated');
        assert.deepEqual(
            followedSnapshot.payload.players.map(player => player.user_id),
            [secondGuestId]
        );

        const spectatorMove = await sendRequest(firstGuest, {
            type: 'player.move',
            request_id: 'spectator-movement-denied',
            payload: { sequence: 0, direction: 'east' }
        });
        assert.equal(spectatorMove.payload.code, 'FORBIDDEN_ROLE');

        const followedMovement = waitForMessage(firstGuest, 'player.moved');
        secondGuest.send(
            JSON.stringify({
                type: 'player.move',
                payload: { sequence: 0, direction: 'north' }
            })
        );
        assert.equal((await followedMovement).payload.user_id, secondGuestId);

        const invalidFollow = await sendRequest(firstGuest, {
            type: 'spectator.follow',
            request_id: 'spectator-follows-inactive-player',
            payload: { target_user_id: firstGuestId }
        });
        assert.equal(invalidFollow.payload.code, 'ACTION_NOT_ALLOWED');

        const retarget = waitForMessage(firstGuest, 'spectator.following');
        const ownerSecondEliminationRanking = waitForMessage(owner, 'ranking.updated');
        const firstSecondEliminationRanking = waitForMessage(firstGuest, 'ranking.updated');
        const secondSecondEliminationRanking = waitForMessage(secondGuest, 'ranking.updated');
        const secondElimination = eliminatePlayer({
            database,
            presence: server.presence,
            roomId,
            userId: secondGuestId
        });
        assert.deepEqual(secondElimination, { userId: secondGuestId, targetUserId: playerId });
        assert.equal((await retarget).payload.target_user_id, playerId);
        const secondEliminationRanking = (await ownerSecondEliminationRanking).payload;
        assert.deepEqual((await firstSecondEliminationRanking).payload, secondEliminationRanking);
        assert.deepEqual((await secondSecondEliminationRanking).payload, secondEliminationRanking);
        assert.deepEqual(
            secondEliminationRanking.entries.map(entry => entry.user_id),
            [playerId, firstGuestId, secondGuestId]
        );
        assert.deepEqual(
            getPlayerViewers(server.presence, roomId, playerId).map(player => player.userId),
            [playerId, firstGuestId, secondGuestId]
        );
    });
});
