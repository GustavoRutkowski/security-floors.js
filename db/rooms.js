const ROOM_MODES = new Set(['classic', 'deathmatch']);
const ROOM_STATUSES = new Set(['waiting', 'playing']);
const UPDATE_FIELDS = new Set([
    'name',
    'owner_id',
    'mode',
    'floors',
    'notebooks_per_floor',
    'time_limit_seconds',
    'max_players',
    'status'
]);

function requireNonEmptyString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${field} must be a non-empty string`);
    }
}

function validateRoomIdentity(room) {
    requireNonEmptyString(room.id, 'id');
    requireNonEmptyString(room.name, 'name');
    requireNonEmptyString(room.owner_id, 'owner_id');
}

export function validateRoomSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new TypeError('Room settings must be an object');
    }

    if (!ROOM_MODES.has(settings.mode)) {
        throw new RangeError('mode must be classic or deathmatch');
    }
    if (!Number.isSafeInteger(settings.floors) || settings.floors < 3 || settings.floors > 30) {
        throw new RangeError('floors must be an integer between 3 and 30');
    }
    if (
        !Number.isSafeInteger(settings.notebooks_per_floor) ||
        settings.notebooks_per_floor < 1 ||
        settings.notebooks_per_floor > 6
    ) {
        throw new RangeError('notebooks_per_floor must be an integer between 1 and 6');
    }
    if (settings.mode === 'deathmatch' && settings.notebooks_per_floor !== 1) {
        throw new RangeError('deathmatch requires exactly one notebook per floor');
    }
    if (
        settings.time_limit_seconds !== null &&
        (!Number.isSafeInteger(settings.time_limit_seconds) || settings.time_limit_seconds < 60)
    ) {
        throw new RangeError('time_limit_seconds must be null or an integer of at least 60');
    }
    if (!Number.isSafeInteger(settings.max_players) || settings.max_players < 1) {
        throw new RangeError('max_players must be a positive integer');
    }
    if (settings.status !== undefined && !ROOM_STATUSES.has(settings.status)) {
        throw new RangeError('status must be waiting or playing');
    }
}

function getRoom(database, id) {
    return database.prepare('SELECT * FROM rooms WHERE id = ?').get(id) ?? null;
}

export function createRoom(database, room) {
    validateRoomIdentity(room);
    validateRoomSettings(room);

    database
        .prepare(
            `
            INSERT INTO rooms (
                id,
                name,
                owner_id,
                mode,
                floors,
                notebooks_per_floor,
                time_limit_seconds,
                max_players
            ) VALUES (
                @id,
                @name,
                @owner_id,
                @mode,
                @floors,
                @notebooks_per_floor,
                @time_limit_seconds,
                @max_players
            )
        `
        )
        .run({
            id: room.id,
            name: room.name,
            owner_id: room.owner_id,
            mode: room.mode,
            floors: room.floors,
            notebooks_per_floor: room.notebooks_per_floor,
            time_limit_seconds: room.time_limit_seconds,
            max_players: room.max_players
        });

    return getRoom(database, room.id);
}

export function listRooms(database, { status } = {}) {
    if (status !== undefined && !ROOM_STATUSES.has(status)) {
        throw new RangeError('status must be waiting or playing');
    }

    if (status === undefined) {
        return database.prepare('SELECT * FROM rooms ORDER BY created_at, id').all();
    }

    return database
        .prepare('SELECT * FROM rooms WHERE status = ? ORDER BY created_at, id')
        .all(status);
}

export function updateRoom(database, id, updates) {
    requireNonEmptyString(id, 'id');
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        throw new TypeError('Room updates must be an object');
    }

    const entries = Object.entries(updates);
    if (entries.length === 0) {
        throw new TypeError('At least one room field must be provided');
    }
    for (const [field] of entries) {
        if (!UPDATE_FIELDS.has(field)) {
            throw new TypeError(`Unsupported room field: ${field}`);
        }
    }

    const updateTransaction = database.transaction(() => {
        const currentRoom = getRoom(database, id);
        if (!currentRoom) return null;

        const updatedRoom = { ...currentRoom, ...updates };
        validateRoomIdentity(updatedRoom);
        validateRoomSettings(updatedRoom);

        const assignments = entries.map(([field]) => `${field} = @${field}`).join(', ');
        database.prepare(`UPDATE rooms SET ${assignments} WHERE id = @id`).run({
            ...Object.fromEntries(entries),
            id
        });

        return getRoom(database, id);
    });

    return updateTransaction();
}

export function deleteRoom(database, id) {
    requireNonEmptyString(id, 'id');
    return database.prepare('DELETE FROM rooms WHERE id = ?').run(id).changes > 0;
}
