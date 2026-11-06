import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { createRoom, updateRoom } from '../db/rooms.js';
import { createPresenceState, getPlayerViewers } from '../ws/presence.js';
import { eliminatePlayer } from '../ws/room-protocol.js';
import { startWebSocketServer, closeWebSocketServer } from '../ws/server.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const logger = { info() {}, error() {} };
const playerId = '11111111-1111-4111-8111-111111111111';

let database;
let server;
let disconnectTimers;
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

function waitForMessage(client, type) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client.off('message', onMessage);
            reject(new Error(`Timed out waiting for ${type}`));
        }, 1000);

        function onMessage(data) {
            const message = JSON.parse(data.toString('utf8'));
            if (message.type !== type) return;
            clearTimeout(timeout);
            client.off('message', onMessage);
            resolve(message);
        }

        client.on('message', onMessage);
    });
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

beforeEach(async () => {
    database = new Database(':memory:');
    database.exec(schema);
    disconnectTimers = [];
    const presence = createPresenceState({
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
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-movement',
            payload: {}
        });

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
            sequence: 0,
            direction: 'east',
            x: 51,
            y: 50
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
        assert.equal(server.presence.rooms.get(roomId).match.movement.get(playerId).x, 51);
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
                max_players: 1
            }
        });
        const roomId = created.payload.room.room_id;
        insertQuestions(6);

        const initialQuestionPromise = waitForMessage(owner, 'question.presented');
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-classic-progression',
            payload: {}
        });
        const firstQuestion = (await initialQuestionPromise).payload;
        assert.equal(firstQuestion.floor, 1);
        assert.equal('correct_option_index' in firstQuestion, false);
        assert.equal('explanation' in firstQuestion, false);

        const secondQuestionPromise = waitForMessage(owner, 'question.presented');
        const firstWrongAnswer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-first-wrong',
            payload: { question_id: firstQuestion.question_id, option_index: 1 }
        });
        const secondQuestion = (await secondQuestionPromise).payload;
        assert.equal(firstWrongAnswer.payload.correct, false);
        assert.equal(firstWrongAnswer.payload.correct_option_index, 0);
        assert.equal(secondQuestion.floor, 1);
        assert.notEqual(secondQuestion.question_id, firstQuestion.question_id);

        const lastWrongAnswer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-last-wrong',
            payload: { question_id: secondQuestion.question_id, option_index: 1 }
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
        const floorTwoQuestionPromise = waitForMessage(owner, 'question.presented');
        doorTimer.callback();
        const floorTwoQuestion = (await floorTwoQuestionPromise).payload;
        assert.equal(floorTwoQuestion.floor, 2);

        const floorTwoNotebookPromise = waitForMessage(owner, 'question.presented');
        const floorTwoWrongAnswer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-floor-two-first-wrong',
            payload: { question_id: floorTwoQuestion.question_id, option_index: 1 }
        });
        const floorTwoNotebook = (await floorTwoNotebookPromise).payload;
        assert.equal(floorTwoWrongAnswer.payload.correct, false);
        assert.equal(floorTwoNotebook.floor, 2);

        const floorThreeQuestionPromise = waitForMessage(owner, 'question.presented');
        const floorTwoCorrectAnswer = await sendRequest(owner, {
            type: 'question.answer',
            request_id: 'classic-floor-two-second-correct',
            payload: { question_id: floorTwoNotebook.question_id, option_index: 0 }
        });
        const floorThreeQuestion = (await floorThreeQuestionPromise).payload;
        assert.equal(floorTwoCorrectAnswer.payload.correct, true);
        assert.equal(floorThreeQuestion.floor, 3);
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

    it('transfers an expired deathmatch owner without removing their match membership', async () => {
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

        const disconnectSnapshot = waitForMessage(guest, 'room.snapshot');
        const ownerSocket = server.presence.connections.get(playerId);
        const ownerSocketClosed = once(ownerSocket, 'close');
        owner.close();
        await ownerSocketClosed;
        await disconnectSnapshot;
        const guestUpdate = waitForMessage(guest, 'room.snapshot');
        disconnectTimers.find(timer => !timer.cleared).callback();

        const snapshot = await guestUpdate;
        assert.equal(snapshot.payload.room.owner_id, guestId);
        assert.deepEqual(
            snapshot.payload.participants.map(participant => participant.user_id),
            [playerId, guestId]
        );
        const disconnectedOwner = server.presence.players.get(playerId);
        assert.equal(disconnectedOwner.roomId, roomId);
        assert.equal(disconnectedOwner.status, 'spectating');
        assert.equal(disconnectedOwner.targetUserId, guestId);
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
        await sendRequest(owner, {
            type: 'match.start',
            request_id: 'start-room-for-spectator-movement',
            payload: {}
        });

        const activeFollow = await sendRequest(owner, {
            type: 'spectator.follow',
            request_id: 'active-follow',
            payload: { target_user_id: firstGuestId }
        });
        assert.equal(activeFollow.payload.code, 'ACTION_NOT_ALLOWED');

        const eliminatedEvent = waitForMessage(owner, 'player.eliminated');
        const spectatorStarted = waitForMessage(firstGuest, 'spectator.started');
        const converted = eliminatePlayer({
            database,
            presence: server.presence,
            roomId,
            userId: firstGuestId
        });
        assert.deepEqual(converted, { userId: firstGuestId, targetUserId: playerId });
        assert.equal((await eliminatedEvent).payload.user_id, firstGuestId);
        assert.equal((await spectatorStarted).payload.target_user_id, playerId);

        const follow = await sendRequest(firstGuest, {
            type: 'spectator.follow',
            request_id: 'spectator-follows-second-guest',
            payload: { target_user_id: secondGuestId }
        });
        assert.equal(follow.type, 'spectator.following');
        assert.equal(follow.request_id, 'spectator-follows-second-guest');
        assert.equal(follow.payload.target_user_id, secondGuestId);

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
        const secondElimination = eliminatePlayer({
            database,
            presence: server.presence,
            roomId,
            userId: secondGuestId
        });
        assert.deepEqual(secondElimination, { userId: secondGuestId, targetUserId: playerId });
        assert.equal((await retarget).payload.target_user_id, playerId);
        assert.deepEqual(
            getPlayerViewers(server.presence, roomId, playerId).map(player => player.userId),
            [playerId, firstGuestId, secondGuestId]
        );
    });
});
