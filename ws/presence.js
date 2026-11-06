const DEFAULT_RECONNECT_GRACE_MS = 30_000;

function requireIdentifier(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${field} must be a non-empty string`);
    }
}

function getRoom(state, roomId) {
    const room = state.rooms.get(roomId);
    if (!room) throw new RangeError(`Unknown room: ${roomId}`);
    return room;
}

function getPlayer(state, userId) {
    const player = state.players.get(userId);
    if (!player) throw new RangeError(`Unknown player: ${userId}`);
    return player;
}

function toPlayerSnapshot(player) {
    return {
        userId: player.userId,
        nickname: player.nickname,
        characterId: player.characterId,
        roomId: player.roomId,
        entryOrder: player.entryOrder,
        connected: player.connected,
        disconnectedAt: player.disconnectedAt,
        reconnectDeadline: player.reconnectDeadline,
        reconnectExpired: player.reconnectExpired,
        status: player.status,
        targetUserId: player.targetUserId
    };
}

export function createPresenceState({
    reconnectGraceMs = DEFAULT_RECONNECT_GRACE_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    nowFn = Date.now,
    onReconnectExpired = () => {},
    onMatchEnded = () => {}
} = {}) {
    if (!Number.isSafeInteger(reconnectGraceMs) || reconnectGraceMs < 0) {
        throw new RangeError('reconnectGraceMs must be a non-negative integer');
    }
    if (typeof nowFn !== 'function') throw new TypeError('nowFn must be a function');

    return {
        rooms: new Map(),
        players: new Map(),
        connections: new Map(),
        nextEntryOrder: 1,
        reconnectGraceMs,
        setTimeoutFn,
        clearTimeoutFn,
        nowFn,
        onReconnectExpired,
        onMatchEnded
    };
}

export function createPresenceRoom(state, roomId, mode = 'classic') {
    requireIdentifier(roomId, 'roomId');
    if (mode !== 'classic' && mode !== 'deathmatch') {
        throw new RangeError('mode must be classic or deathmatch');
    }
    if (state.rooms.has(roomId)) return false;

    state.rooms.set(roomId, {
        roomId,
        mode,
        revision: 0,
        match: null,
        playerIds: new Set(),
        spectatorIds: new Set()
    });
    return true;
}

export function deletePresenceRoom(state, roomId) {
    const room = state.rooms.get(roomId);
    if (!room) return false;

    for (const userId of room.playerIds) {
        const player = state.players.get(userId);
        if (!player) continue;

        clearDisconnectTimer(state, player);
        player.roomId = null;
        player.entryOrder = null;
        player.status = 'waiting';
        player.targetUserId = null;
        player.reconnectDeadline = null;
        player.reconnectExpired = false;
    }

    state.rooms.delete(roomId);
    return true;
}

function clearDisconnectTimer(state, player) {
    if (player.disconnectTimer !== null) {
        state.clearTimeoutFn(player.disconnectTimer);
        player.disconnectTimer = null;
    }
}

export function connectPlayer(state, profile, connection, { now = Date.now() } = {}) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        throw new TypeError('Player profile must be an object');
    }
    requireIdentifier(profile.userId, 'userId');
    requireIdentifier(profile.nickname, 'nickname');
    requireIdentifier(profile.characterId, 'characterId');
    if (!connection || (typeof connection !== 'object' && typeof connection !== 'function')) {
        throw new TypeError('connection must be an object');
    }

    let player = state.players.get(profile.userId);
    const resumed = Boolean(player?.roomId && player.reconnectDeadline !== null);
    const wasConnected = player?.connected ?? false;
    if (resumed && now > player.reconnectDeadline) {
        throw new RangeError('Player reconnection window has expired');
    }

    const replacedConnection = state.connections.get(profile.userId) ?? null;
    if (!player) {
        player = {
            userId: profile.userId,
            nickname: profile.nickname,
            characterId: profile.characterId,
            roomId: null,
            entryOrder: null,
            connected: false,
            disconnectedAt: null,
            reconnectDeadline: null,
            reconnectExpired: false,
            disconnectTimer: null,
            status: 'waiting',
            targetUserId: null
        };
        state.players.set(player.userId, player);
    }

    clearDisconnectTimer(state, player);
    player.nickname = profile.nickname;
    player.characterId = profile.characterId;
    player.connected = true;
    player.disconnectedAt = null;
    player.reconnectDeadline = null;
    player.reconnectExpired = false;
    state.connections.set(player.userId, connection);
    if (resumed && !wasConnected) {
        const room = state.rooms.get(player.roomId);
        if (room) room.revision += 1;
    }

    return {
        player: toPlayerSnapshot(player),
        replacedConnection,
        resumed
    };
}

export function disconnectPlayer(state, userId, connection, { now = Date.now() } = {}) {
    const player = state.players.get(userId);
    if (!player || !player.connected) return false;

    const currentConnection = state.connections.get(userId);
    if (connection && currentConnection !== connection) return false;

    state.connections.delete(userId);
    player.connected = false;
    player.disconnectedAt = now;
    player.reconnectDeadline = now + state.reconnectGraceMs;
    player.reconnectExpired = false;
    if (player.roomId) {
        const room = state.rooms.get(player.roomId);
        if (room) room.revision += 1;
    }

    clearDisconnectTimer(state, player);
    const expectedDeadline = player.reconnectDeadline;
    player.disconnectTimer = state.setTimeoutFn(() => {
        player.disconnectTimer = null;
        if (player.connected || player.reconnectDeadline !== expectedDeadline) return;

        player.reconnectExpired = true;
        state.onReconnectExpired({
            player: toPlayerSnapshot(player),
            roomId: player.roomId
        });
    }, state.reconnectGraceMs);
    player.disconnectTimer.unref?.();

    return true;
}

export function joinRoomPresence(state, roomId, userId) {
    const room = getRoom(state, roomId);
    const player = getPlayer(state, userId);

    if (!player.connected) throw new Error('Player must be connected to join a room');
    if (player.roomId && player.roomId !== roomId) {
        throw new Error('Player already belongs to another room');
    }
    if (player.roomId === roomId) return toPlayerSnapshot(player);

    player.roomId = roomId;
    player.entryOrder = state.nextEntryOrder;
    state.nextEntryOrder += 1;
    player.status = 'active';
    player.targetUserId = null;
    room.playerIds.add(userId);
    room.revision += 1;

    return toPlayerSnapshot(player);
}

export function leaveRoomPresence(state, roomId, userId) {
    const room = getRoom(state, roomId);
    const player = getPlayer(state, userId);
    if (player.roomId !== roomId || !room.playerIds.has(userId)) return null;

    clearDisconnectTimer(state, player);
    room.playerIds.delete(userId);
    room.spectatorIds.delete(userId);
    room.revision += 1;
    player.roomId = null;
    player.entryOrder = null;
    player.reconnectDeadline = null;
    player.reconnectExpired = false;
    player.status = 'waiting';
    player.targetUserId = null;

    const nextTarget = [...room.playerIds]
        .map(id => state.players.get(id))
        .find(candidate => candidate.status === 'active');
    retargetSpectators(state, room, userId, nextTarget?.userId ?? null);

    return {
        player: toPlayerSnapshot(player),
        roomEmpty: room.playerIds.size === 0
    };
}

export function returnMatchParticipantsToLobby(state, roomId) {
    const room = getRoom(state, roomId);
    if (!room.match) return null;
    if (!room.match.ended) throw new Error('Match must be ended before returning to the lobby');

    for (const userId of room.playerIds) {
        const player = state.players.get(userId);
        if (!player) continue;
        player.status = 'active';
        player.targetUserId = null;
    }
    room.spectatorIds.clear();
    room.match = null;
    room.revision += 1;

    return getRoomPresence(state, roomId);
}

export function setPlayerSpectating(state, roomId, userId, targetUserId) {
    const room = getRoom(state, roomId);
    if (room.mode !== 'deathmatch') {
        throw new Error('Spectating is only available after elimination in deathmatch');
    }

    const player = getPlayer(state, userId);
    if (player.roomId !== roomId || !room.playerIds.has(userId)) {
        throw new Error('Player must belong to the room to spectate');
    }

    const activePlayers = [...room.playerIds]
        .map(id => state.players.get(id))
        .filter(candidate => candidate.status === 'active' && candidate.userId !== userId);
    const target = targetUserId
        ? activePlayers.find(candidate => candidate.userId === targetUserId)
        : (activePlayers[0] ?? null);

    if (targetUserId && !target) {
        throw new Error('Spectator target must be an active player in the room');
    }

    player.status = 'spectating';
    player.targetUserId = target?.userId ?? null;
    room.spectatorIds.add(userId);
    retargetSpectators(state, room, userId, target?.userId ?? null);
    room.revision += 1;
    return toPlayerSnapshot(player);
}

function retargetSpectators(state, room, previousTargetId, nextTargetId) {
    for (const spectatorId of room.spectatorIds) {
        const spectator = state.players.get(spectatorId);
        if (spectator?.targetUserId === previousTargetId) {
            spectator.targetUserId = nextTargetId;
        }
    }
}

export function setSpectatorTarget(state, roomId, userId, targetUserId) {
    const room = getRoom(state, roomId);
    const player = getPlayer(state, userId);
    if (player.roomId !== roomId || player.status !== 'spectating') {
        throw new Error('Player must be spectating in the room');
    }

    const target = state.players.get(targetUserId);
    if (
        !target ||
        !room.playerIds.has(targetUserId) ||
        target.roomId !== roomId ||
        target.status !== 'active'
    ) {
        throw new Error('Spectator target must be an active player in the room');
    }

    player.targetUserId = targetUserId;
    room.revision += 1;
    return toPlayerSnapshot(player);
}

export function getRoomPresence(state, roomId) {
    const room = getRoom(state, roomId);
    const players = [...room.playerIds]
        .map(userId => state.players.get(userId))
        .filter(Boolean)
        .sort((left, right) => left.entryOrder - right.entryOrder)
        .map(toPlayerSnapshot);

    return {
        roomId,
        mode: room.mode,
        revision: room.revision,
        players,
        spectators: players.filter(player => room.spectatorIds.has(player.userId))
    };
}

export function getPlayerViewers(state, roomId, targetUserId) {
    const room = getRoom(state, roomId);
    const target = getPlayer(state, targetUserId);
    if (
        target.roomId !== roomId ||
        !room.playerIds.has(targetUserId) ||
        target.status !== 'active'
    ) {
        throw new RangeError('Viewer target must be an active player in the room');
    }

    return [...room.playerIds]
        .map(userId => state.players.get(userId))
        .filter(
            player =>
                player &&
                (player.userId === targetUserId ||
                    (player.status === 'spectating' && player.targetUserId === targetUserId))
        )
        .sort((left, right) => left.entryOrder - right.entryOrder)
        .map(toPlayerSnapshot);
}
