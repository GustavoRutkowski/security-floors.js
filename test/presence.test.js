import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    connectPlayer,
    createPresenceRoom,
    createPresenceState,
    deletePresenceRoom,
    disconnectPlayer,
    getPlayerViewers,
    getRoomPresence,
    joinRoomPresence,
    leaveRoomPresence,
    setPlayerSpectating,
    setSpectatorTarget
} from '../ws/presence.js';

function createFakeScheduler() {
    const timers = new Map();
    let nextTimerId = 0;

    return {
        timers,
        setTimeoutFn(callback, delay) {
            const timer = { callback, delay, unref() {} };
            timers.set(++nextTimerId, timer);
            return nextTimerId;
        },
        clearTimeoutFn(timerId) {
            timers.delete(timerId);
        }
    };
}

function connect(state, userId, connection = {}) {
    return connectPlayer(state, { userId, nickname: userId, characterId: 'avatar-1' }, connection);
}

describe('authoritative room presence state', () => {
    it('tracks connected players and stable room entry order in memory', () => {
        const state = createPresenceState();
        createPresenceRoom(state, 'room-1');
        connect(state, 'player-1');
        connect(state, 'player-2');

        joinRoomPresence(state, 'room-1', 'player-1');
        joinRoomPresence(state, 'room-1', 'player-2');
        joinRoomPresence(state, 'room-1', 'player-1');

        const presence = getRoomPresence(state, 'room-1');
        assert.deepEqual(
            presence.players.map(player => player.userId),
            ['player-1', 'player-2']
        );
        assert.deepEqual(
            presence.players.map(player => player.entryOrder),
            [1, 2]
        );
        assert.equal(
            presence.players.every(player => player.connected),
            true
        );
        assert.equal(presence.spectators.length, 0);
    });

    it('preserves membership on disconnect, resumes in grace, and ignores stale socket closes', () => {
        const scheduler = createFakeScheduler();
        const state = createPresenceState(scheduler);
        createPresenceRoom(state, 'room-1');
        const oldConnection = {};
        connect(state, 'player-1', oldConnection);
        joinRoomPresence(state, 'room-1', 'player-1');

        assert.equal(disconnectPlayer(state, 'player-1', oldConnection, { now: 100 }), true);
        assert.deepEqual(state.connections.has('player-1'), false);

        const newConnection = {};
        const result = connectPlayer(
            state,
            { userId: 'player-1', nickname: 'Renamed', characterId: 'avatar-2' },
            newConnection,
            { now: 200 }
        );

        assert.equal(result.resumed, true);
        assert.equal(result.player.entryOrder, 1);
        assert.equal(result.player.nickname, 'Renamed');
        assert.equal(result.replacedConnection, null);
        assert.equal(disconnectPlayer(state, 'player-1', oldConnection), false);
        assert.equal(state.connections.get('player-1'), newConnection);
        assert.equal(scheduler.timers.size, 0);
    });

    it('reports reconnection expiry without persisting user data', () => {
        const scheduler = createFakeScheduler();
        const expiredPlayers = [];
        const state = createPresenceState({
            reconnectGraceMs: 30,
            ...scheduler,
            onReconnectExpired: event => expiredPlayers.push(event)
        });
        createPresenceRoom(state, 'room-1');
        const connection = {};
        connect(state, 'player-1', connection);
        joinRoomPresence(state, 'room-1', 'player-1');
        disconnectPlayer(state, 'player-1', connection, { now: 100 });

        const timer = [...scheduler.timers.values()][0];
        assert.equal(timer.delay, 30);
        timer.callback();

        assert.equal(expiredPlayers.length, 1);
        assert.equal(expiredPlayers[0].roomId, 'room-1');
        assert.equal(expiredPlayers[0].player.reconnectExpired, true);
        assert.equal(getRoomPresence(state, 'room-1').players.length, 1);
        assert.equal(Object.hasOwn(expiredPlayers[0].player, 'socket'), false);
        assert.throws(
            () => connect(state, 'player-1', {}, { now: 131 }),
            /reconnection window has expired/
        );
    });

    it('tracks eliminated spectators and restricts their follow target to active room members', () => {
        const state = createPresenceState();
        createPresenceRoom(state, 'room-1', 'deathmatch');
        for (const userId of ['player-1', 'player-2', 'player-3']) {
            connect(state, userId);
            joinRoomPresence(state, 'room-1', userId);
        }

        setPlayerSpectating(state, 'room-1', 'player-3', 'player-1');
        setSpectatorTarget(state, 'room-1', 'player-3', 'player-2');

        const presence = getRoomPresence(state, 'room-1');
        assert.deepEqual(
            presence.spectators.map(player => player.userId),
            ['player-3']
        );
        assert.equal(presence.spectators[0].targetUserId, 'player-2');
        assert.throws(
            () => setSpectatorTarget(state, 'room-1', 'player-3', 'player-3'),
            /active player/
        );
    });

    it('retargets spectators when their target is eliminated and filters player viewers', () => {
        const state = createPresenceState();
        createPresenceRoom(state, 'room-1', 'deathmatch');
        for (const userId of ['player-1', 'player-2', 'player-3', 'player-4']) {
            connect(state, userId);
            joinRoomPresence(state, 'room-1', userId);
        }

        setPlayerSpectating(state, 'room-1', 'player-3', 'player-1');
        setPlayerSpectating(state, 'room-1', 'player-4', 'player-1');
        setPlayerSpectating(state, 'room-1', 'player-1', 'player-2');

        const presence = getRoomPresence(state, 'room-1');
        assert.deepEqual(
            presence.spectators.map(player => [player.userId, player.targetUserId]),
            [
                ['player-1', 'player-2'],
                ['player-3', 'player-2'],
                ['player-4', 'player-2']
            ]
        );
        assert.deepEqual(
            getPlayerViewers(state, 'room-1', 'player-2').map(player => player.userId),
            ['player-1', 'player-2', 'player-3', 'player-4']
        );
        assert.throws(() => getPlayerViewers(state, 'room-1', 'player-1'), /active player/);
    });

    it('does not allow spectators in classic rooms', () => {
        const state = createPresenceState();
        createPresenceRoom(state, 'room-1', 'classic');
        connect(state, 'player-1');
        connect(state, 'player-2');
        joinRoomPresence(state, 'room-1', 'player-1');
        joinRoomPresence(state, 'room-1', 'player-2');

        assert.throws(
            () => setPlayerSpectating(state, 'room-1', 'player-2', 'player-1'),
            /only available.*deathmatch/
        );
    });

    it('cleans room membership while keeping the connected user session', () => {
        const state = createPresenceState();
        createPresenceRoom(state, 'room-1');
        const connection = {};
        connect(state, 'player-1', connection);
        joinRoomPresence(state, 'room-1', 'player-1');

        const result = leaveRoomPresence(state, 'room-1', 'player-1');
        assert.equal(result.roomEmpty, true);
        assert.equal(state.connections.get('player-1'), connection);
        assert.equal(result.player.roomId, null);
        assert.equal(deletePresenceRoom(state, 'room-1'), true);
        assert.equal(deletePresenceRoom(state, 'room-1'), false);
        assert.equal(state.players.has('player-1'), true);
    });
});
