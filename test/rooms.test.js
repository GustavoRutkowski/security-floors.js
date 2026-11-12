import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import {
    createRoom,
    deleteRoom,
    listRooms,
    updateRoom,
    validateRoomSettings
} from '../db/rooms.js';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const baseRoom = {
    id: 'room-1',
    name: 'Training room',
    owner_id: 'player-1',
    mode: 'classic',
    floors: 10,
    notebooks_per_floor: 3,
    time_limit_seconds: 300,
    max_players: 8
};

let database;

beforeEach(() => {
    database = new Database(':memory:');
    database.exec(schema);
});

afterEach(() => {
    database.close();
});

describe('room persistence operations', () => {
    it('creates rooms and lists them with an optional status filter', () => {
        const created = createRoom(database, baseRoom);
        createRoom(database, {
            ...baseRoom,
            id: 'room-2',
            name: 'Deathmatch',
            mode: 'deathmatch',
            notebooks_per_floor: 1
        });
        updateRoom(database, 'room-2', { status: 'playing' });

        assert.equal(created.id, baseRoom.id);
        assert.equal(created.status, 'waiting');
        assert.equal(created.created_at.length > 0, true);
        assert.deepEqual(
            listRooms(database).map(room => room.id),
            ['room-1', 'room-2']
        );
        assert.deepEqual(
            listRooms(database, { status: 'playing' }).map(room => room.id),
            ['room-2']
        );
        assert.deepEqual(
            listRooms(database, { status: 'waiting' }).map(room => room.id),
            ['room-1']
        );
    });

    it('validates room settings and required identity fields before insertion', () => {
        const invalidRooms = [
            { ...baseRoom, floors: 2 },
            { ...baseRoom, floors: 31 },
            { ...baseRoom, floors: 3.5 },
            { ...baseRoom, notebooks_per_floor: 0 },
            { ...baseRoom, notebooks_per_floor: 5 },
            { ...baseRoom, notebooks_per_floor: 7 },
            { ...baseRoom, mode: 'unknown' },
            { ...baseRoom, time_limit_seconds: 59 },
            { ...baseRoom, time_limit_seconds: 60.5 },
            { ...baseRoom, max_players: 0 },
            { ...baseRoom, max_players: 2.5 },
            { ...baseRoom, id: '' },
            { ...baseRoom, owner_id: '' },
            { ...baseRoom, name: '  ' },
            { ...baseRoom, mode: 'deathmatch', notebooks_per_floor: 2 }
        ];

        for (const room of invalidRooms) {
            assert.throws(() => createRoom(database, room));
        }

        assert.doesNotThrow(() =>
            validateRoomSettings({
                ...baseRoom,
                time_limit_seconds: null
            })
        );
        assert.equal(listRooms(database).length, 0);
    });

    it('updates validated settings and owner fields without allowing SQL injection', () => {
        createRoom(database, baseRoom);
        const updated = updateRoom(database, 'room-1', {
            name: "O'Brien; DROP TABLE rooms;--",
            owner_id: 'player-2',
            floors: 12,
            time_limit_seconds: null
        });

        assert.equal(updated.name, "O'Brien; DROP TABLE rooms;--");
        assert.equal(updated.owner_id, 'player-2');
        assert.equal(updated.floors, 12);
        assert.equal(updated.time_limit_seconds, null);
        assert.equal(listRooms(database).length, 1);
    });

    it('rejects invalid updates and returns null for an unknown room', () => {
        createRoom(database, baseRoom);

        assert.throws(() => updateRoom(database, 'room-1', { floors: 31 }), /floors/);
        assert.throws(
            () => updateRoom(database, 'room-1', { mode: 'deathmatch' }),
            /deathmatch requires/
        );
        assert.throws(() => updateRoom(database, 'room-1', { status: 'closed' }), /status/);
        assert.throws(() => updateRoom(database, 'room-1', { created_at: 'now' }), /Unsupported/);
        assert.throws(() => updateRoom(database, 'room-1', {}), /At least one/);
        assert.equal(updateRoom(database, 'missing-room', { name: 'No room' }), null);
        assert.throws(() => listRooms(database, { status: 'closed' }), /status/);
    });

    it('deletes rooms and reports whether a row was removed', () => {
        createRoom(database, baseRoom);

        assert.equal(deleteRoom(database, 'room-1'), true);
        assert.equal(deleteRoom(database, 'room-1'), false);
        assert.equal(listRooms(database).length, 0);
    });
});
