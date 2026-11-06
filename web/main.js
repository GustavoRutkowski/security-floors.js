import '@fontsource/press-start-2p';
import './style.css';
import { CHARACTERS, loadProfile, saveProfile } from './profile.js';
import { createTopDownGame } from './game-scene.js';
import { WebSocketClient } from './websocket-client.js';

const profileScreen = document.getElementById('profile-screen');
const homeScreen = document.getElementById('home-screen');
const profileForm = document.getElementById('profile-form');
const nicknameInput = document.getElementById('nickname');
const profileError = document.getElementById('profile-error');
const characterInputs = [...document.querySelectorAll('input[name="character_id"]')];
const refreshRoomsButton = document.getElementById('refresh-rooms');
const roomList = document.getElementById('room-list');
const roomsStatus = document.getElementById('rooms-status');
const roomsError = document.getElementById('rooms-error');
const lobbyScreen = document.getElementById('lobby-screen');
const lobbyConfigForm = document.getElementById('lobby-config-form');
const lobbyError = document.getElementById('lobby-error');
const createRoomDialog = document.getElementById('create-room-dialog');
const createRoomForm = document.getElementById('create-room-form');
const gameScreen = document.getElementById('game-screen');
const gameRoot = document.getElementById('game-root');
let websocketClient;
let roomPollingTimer;
let selectedRoomId;
let currentRoomSnapshot;
let currentMatchSnapshot;
let topDownGame;

function getWebSocketUrl() {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:3001`;
}

function updateConnectionStatus(status, message = null) {
    const labels = {
        disconnected: 'DESCONECTADO',
        connecting: 'CONECTANDO',
        open: 'AUTENTICANDO',
        ready: 'ONLINE',
        reconnecting: 'RECONEXÃO',
        closed: 'DESCONECTADO'
    };
    document.getElementById('system-status').textContent = message || labels[status] || status;
    document.getElementById('footer-state').textContent = `WS / ${labels[status] || status}`;
}

function showRoomsError(message) {
    roomsError.textContent = message;
    roomsError.hidden = false;
}

function clearRoomsError() {
    roomsError.hidden = true;
    roomsError.textContent = '';
}

function formatRoomMode(mode) {
    return mode === 'deathmatch' ? 'MATA-MATA' : 'CLÁSSICO';
}

function renderRooms(rooms) {
    roomList.replaceChildren();
    if (rooms.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.className = 'room-empty';
        emptyState.textContent = 'NENHUMA SALA AGUARDANDO JOGADORES';
        roomList.append(emptyState);
        return;
    }

    for (const room of rooms) {
        const card = document.createElement('article');
        card.className = `room-card${room.room_id === selectedRoomId ? ' room-card--selected' : ''}`;

        const info = document.createElement('div');
        info.className = 'room-card-info';
        const name = document.createElement('strong');
        name.className = 'room-card-name';
        name.textContent = room.name;
        const meta = document.createElement('p');
        meta.className = 'room-card-meta';
        const mode = document.createElement('span');
        const modeLabel = document.createElement('strong');
        modeLabel.textContent = formatRoomMode(room.mode);
        mode.append(modeLabel);
        const players = document.createElement('span');
        players.textContent = `${room.player_count} / ${room.max_players} JOGADORES`;
        const floors = document.createElement('span');
        floors.textContent = `${room.floors} ANDARES`;
        meta.append(mode, players, floors);
        info.append(name, meta);

        const joinButton = document.createElement('button');
        joinButton.className = 'secondary-button';
        joinButton.type = 'button';
        joinButton.textContent = room.room_id === selectedRoomId ? 'CONECTADO' : 'ENTRAR';
        joinButton.disabled = room.room_id === selectedRoomId;
        joinButton.addEventListener('click', () => joinRoom(room, joinButton));

        card.append(info, joinButton);
        roomList.append(card);
    }
}

function refreshRooms() {
    if (!websocketClient || websocketClient.status !== 'ready') {
        roomsStatus.textContent = 'AGUARDANDO CONEXÃO';
        return Promise.resolve();
    }

    refreshRoomsButton.disabled = true;
    roomsStatus.textContent = 'BUSCANDO SALAS...';
    clearRoomsError();
    return websocketClient
        .listRooms()
        .then(response => {
            const rooms = response.payload?.rooms;
            if (!Array.isArray(rooms)) throw new Error('A lista de salas recebida é inválida.');
            renderRooms(rooms);
            roomsStatus.textContent =
                rooms.length === 1 ? '1 SALA DISPONÍVEL' : `${rooms.length} SALAS DISPONÍVEIS`;
        })
        .catch(error => {
            roomsStatus.textContent = 'NÃO FOI POSSÍVEL ATUALIZAR';
            showRoomsError(error.message || 'Não foi possível carregar as salas.');
        })
        .finally(() => {
            refreshRoomsButton.disabled = false;
        });
}

function joinRoom(room, button) {
    if (!websocketClient || websocketClient.status !== 'ready') return;
    button.disabled = true;
    button.textContent = 'ENTRANDO...';
    clearRoomsError();
    roomsStatus.textContent = `ENTRANDO EM ${room.name.toUpperCase()}...`;
    websocketClient
        .joinRoom(room.room_id)
        .then(snapshot => {
            selectedRoomId = snapshot.payload.room.room_id;
            roomsStatus.textContent = `SALA CONECTADA / ${snapshot.payload.room.name}`;
            renderRooms([room]);
            showLobby(snapshot.payload);
            window.dispatchEvent(
                new CustomEvent('security-floors:room-ready', { detail: snapshot.payload })
            );
        })
        .catch(error => {
            button.disabled = false;
            button.textContent = 'ENTRAR';
            roomsStatus.textContent = 'SALA NÃO DISPONÍVEL';
            showRoomsError(error.message || 'Não foi possível entrar na sala.');
            refreshRooms();
        });
}

function startRoomPolling() {
    if (roomPollingTimer !== undefined) return;
    roomPollingTimer = window.setInterval(refreshRooms, 15000);
}

function stopRoomPolling() {
    if (roomPollingTimer === undefined) return;
    window.clearInterval(roomPollingTimer);
    roomPollingTimer = undefined;
}

function showLobby(snapshot) {
    topDownGame?.destroy();
    topDownGame = undefined;
    currentMatchSnapshot = undefined;
    currentRoomSnapshot = snapshot;
    selectedRoomId = snapshot.room.room_id;
    stopRoomPolling();
    profileScreen.hidden = true;
    homeScreen.hidden = true;
    lobbyScreen.hidden = false;
    document.documentElement.dataset.screen = 'lobby';
    updateLobby(snapshot);
}

function showGame(snapshot = currentMatchSnapshot) {
    currentMatchSnapshot = snapshot;
    stopRoomPolling();
    profileScreen.hidden = true;
    homeScreen.hidden = true;
    lobbyScreen.hidden = true;
    gameScreen.hidden = false;
    document.documentElement.dataset.screen = 'game';
    if (topDownGame) {
        if (snapshot) topDownGame.applySnapshot(snapshot);
        return;
    }
    const profile = loadProfile();
    topDownGame = createTopDownGame({
        root: gameRoot,
        client: websocketClient,
        profile,
        snapshot,
        onHudUpdate: ({ floor, status }) => {
            document.getElementById('game-floor').textContent = String(floor).padStart(2, '0');
            document.getElementById('game-player-status').textContent = status;
        }
    });
}

function showHome() {
    topDownGame?.destroy();
    topDownGame = undefined;
    currentMatchSnapshot = undefined;
    currentRoomSnapshot = undefined;
    selectedRoomId = undefined;
    lobbyScreen.hidden = true;
    setScreen('home', loadProfile());
    if (websocketClient?.status === 'ready') {
        refreshRooms();
        startRoomPolling();
    }
}

function roomTimeLabel(seconds) {
    return seconds === null ? 'SEM LIMITE' : `${seconds} SEGUNDOS`;
}

function setLobbyError(message) {
    lobbyError.textContent = message;
    lobbyError.hidden = false;
}

function clearLobbyError() {
    lobbyError.textContent = '';
    lobbyError.hidden = true;
}

function setFormValue(id, value) {
    document.getElementById(id).value = value;
}

function updateLobby(snapshot) {
    const { room, participants } = snapshot;
    const profile = loadProfile();
    const isOwner = room.owner_id === profile?.user_id;
    const isWaiting = room.status === 'waiting';
    document.getElementById('lobby-title').textContent = isWaiting
        ? 'AGUARDANDO JOGADORES'
        : 'PARTIDA EM ANDAMENTO';
    document.getElementById('lobby-status').lastChild.textContent = isWaiting
        ? ' AGUARDANDO'
        : ' EM JOGO';
    document.getElementById('lobby-room-name').textContent = room.name;
    document.getElementById('lobby-room-mode').textContent = formatRoomMode(room.mode);
    document.getElementById('lobby-room-floors').textContent = String(room.floors).padStart(2, '0');
    document.getElementById('lobby-room-notebooks').textContent = String(
        room.notebooks_per_floor
    ).padStart(2, '0');
    document.getElementById('lobby-room-time').textContent = roomTimeLabel(room.time_limit_seconds);
    document.getElementById('lobby-room-capacity').textContent =
        `${String(participants.length).padStart(2, '0')} / ${String(room.max_players).padStart(2, '0')}`;
    document.getElementById('participant-count').textContent = String(participants.length).padStart(
        2,
        '0'
    );

    const participantList = document.getElementById('participant-list');
    participantList.replaceChildren();
    for (const participant of participants) {
        const item = document.createElement('div');
        item.className = `participant-item${participant.user_id === room.owner_id ? ' participant-item--owner' : ''}`;
        const name = document.createElement('span');
        name.className = 'participant-name';
        name.textContent = participant.nickname;
        const state = document.createElement('span');
        state.className =
            participant.user_id === room.owner_id ? 'participant-badge' : 'participant-connection';
        state.textContent =
            participant.user_id === room.owner_id
                ? 'OWNER'
                : participant.connected
                  ? 'ONLINE'
                  : 'RECONEXÃO';
        item.append(name, state);
        participantList.append(item);
    }

    lobbyConfigForm.hidden = !isOwner || !isWaiting;
    document.getElementById('start-match').disabled = !isOwner || !isWaiting;
    if (isOwner && isWaiting && !lobbyConfigForm.matches(':focus-within')) {
        setFormValue('lobby-name', room.name);
        setFormValue('lobby-mode', room.mode);
        setFormValue('lobby-floors', room.floors);
        setFormValue('lobby-notebooks', room.notebooks_per_floor);
        setFormValue('lobby-time', room.time_limit_seconds ?? '');
        setFormValue('lobby-max-players', room.max_players);
        syncDeathmatchNotebooks('lobby-mode', 'lobby-notebooks');
    }
}

function getRoomSettings(form) {
    const data = new FormData(form);
    const timeLimit = data.get('time_limit_seconds');
    return {
        name: data.get('name').trim(),
        mode: data.get('mode'),
        floors: Number(data.get('floors')),
        notebooks_per_floor: Number(data.get('notebooks_per_floor')),
        time_limit_seconds: timeLimit === '' ? null : Number(timeLimit),
        max_players: Number(data.get('max_players'))
    };
}

function syncDeathmatchNotebooks(modeId, notebooksId) {
    const mode = document.getElementById(modeId);
    const notebooks = document.getElementById(notebooksId);
    const deathmatch = mode.value === 'deathmatch';
    notebooks.readOnly = deathmatch;
    if (deathmatch) notebooks.value = '1';
}

function connectWebSocket(profile) {
    websocketClient?.close();
    try {
        websocketClient = new WebSocketClient({ url: getWebSocketUrl(), profile });
    } catch (error) {
        updateConnectionStatus('disconnected', 'WS INDISPONÍVEL');
        profileError.textContent = error.message;
        profileError.hidden = false;
        return;
    }

    websocketClient.addEventListener('status', event => {
        updateConnectionStatus(event.detail.status);
    });
    websocketClient.addEventListener('session.ready', () => {
        if (currentRoomSnapshot) return;
        refreshRooms();
        startRoomPolling();
    });
    websocketClient.addEventListener('room.snapshot', event => {
        const snapshot = event.detail.payload;
        if (snapshot.room.status === 'playing') {
            currentRoomSnapshot = snapshot;
            return;
        }
        showLobby(snapshot);
    });
    websocketClient.addEventListener('room.left', () => {
        showHome();
        document.getElementById('lobby-message').textContent = 'VOCÊ SAIU DA SALA';
    });
    websocketClient.addEventListener('match.started', () => {
        document.getElementById('lobby-message').textContent = 'PARTIDA INICIADA';
        showGame();
        window.dispatchEvent(new CustomEvent('security-floors:match-started'));
    });
    websocketClient.addEventListener('match.snapshot', event => {
        showGame(event.detail.payload);
    });
    websocketClient.addEventListener('player.moved', event => {
        const movement = event.detail.payload;
        const player = currentMatchSnapshot?.players.find(
            candidate => candidate.user_id === movement.user_id
        );
        const updatedPlayer = {
            user_id: movement.user_id,
            x: movement.x,
            y: movement.y,
            floor: player?.floor ?? 1,
            status: player?.status ?? 'playing'
        };
        if (currentMatchSnapshot) {
            const players = currentMatchSnapshot.players.filter(
                candidate => candidate.user_id !== movement.user_id
            );
            currentMatchSnapshot = {
                ...currentMatchSnapshot,
                players: [...players, updatedPlayer]
            };
        }
        topDownGame?.updateMovement(updatedPlayer);
    });
    websocketClient.addEventListener('spectator.started', event => {
        const target = event.detail.payload.target_user_id;
        const note = document.getElementById('spectator-note');
        note.textContent = target
            ? `VOCÊ FOI ELIMINADO. ACOMPANHANDO ${target}.`
            : 'VOCÊ FOI ELIMINADO. NÃO HÁ JOGADORES ATIVOS PARA ACOMPANHAR.';
        note.hidden = false;
    });
    websocketClient.addEventListener('spectator.following', event => {
        const note = document.getElementById('spectator-note');
        note.textContent = `ACOMPANHANDO ${event.detail.payload.target_user_id}.`;
        note.hidden = false;
    });
    websocketClient.addEventListener('protocol-error', event => {
        updateConnectionStatus(websocketClient.status, event.detail.message);
    });
    websocketClient.addEventListener('error', event => {
        const detail = event.detail;
        updateConnectionStatus(
            websocketClient.status,
            detail?.type === 'error' ? detail.payload.message : 'ERRO DE CONEXÃO'
        );
    });
    websocketClient.connect();
}

function getCharacter(characterId) {
    return CHARACTERS.find(character => character.id === characterId) ?? CHARACTERS[0];
}

function updateCharacterPreview(characterId) {
    const character = getCharacter(characterId);
    const preview = document.getElementById('character-preview');
    const stage = document.getElementById('preview-stage');

    preview.dataset.character = character.id;
    preview.setAttribute('aria-label', character.name);
    stage.dataset.character = character.id;
    document.getElementById('preview-name').textContent = character.name;
    document.getElementById('preview-index').textContent =
        `CHAR / ${String(CHARACTERS.indexOf(character) + 1).padStart(2, '0')}`;
}

function setScreen(screenName, profile) {
    const showHome = screenName === 'home';
    profileScreen.hidden = showHome;
    homeScreen.hidden = !showHome;
    document.documentElement.dataset.screen = screenName;
    document.getElementById('system-status').textContent = showHome
        ? 'PERFIL ATIVO'
        : 'PERFIL LOCAL';
    document.getElementById('footer-state').textContent = showHome
        ? 'CLIENTE LOCAL / HOME'
        : 'CLIENTE LOCAL / PERFIL';

    if (showHome && profile) {
        const character = getCharacter(profile.character_id);
        document.getElementById('home-nickname').textContent = profile.nickname;
        document.getElementById('home-character-name').textContent =
            `${character.name} / CHAR ${String(CHARACTERS.indexOf(character) + 1).padStart(2, '0')}`;
        document.getElementById('home-character').dataset.character = character.id;
    }
}

function applyProfileToForm(profile) {
    if (!profile) return;
    nicknameInput.value = profile.nickname;
    const selectedInput = characterInputs.find(input => input.value === profile.character_id);
    if (selectedInput) selectedInput.checked = true;
    updateCharacterPreview(profile.character_id);
}

for (const input of characterInputs) {
    input.addEventListener('change', () => {
        if (input.checked) updateCharacterPreview(input.value);
    });
}

profileForm.addEventListener('submit', event => {
    event.preventDefault();
    profileError.hidden = true;

    const selectedCharacter = characterInputs.find(input => input.checked)?.value;
    try {
        const profile = saveProfile({
            nickname: nicknameInput.value,
            character_id: selectedCharacter
        });
        applyProfileToForm(profile);
        setScreen('home', profile);
        connectWebSocket(profile);
        window.dispatchEvent(new CustomEvent('security-floors:profile-ready', { detail: profile }));
    } catch (error) {
        profileError.textContent =
            error.message || 'Não foi possível salvar o perfil neste navegador.';
        profileError.hidden = false;
        if (!nicknameInput.value.trim()) nicknameInput.focus();
    }
});

document.getElementById('edit-profile').addEventListener('click', () => {
    stopRoomPolling();
    websocketClient?.close();
    websocketClient = undefined;
    applyProfileToForm(loadProfile());
    setScreen('profile');
    nicknameInput.focus();
});

document.getElementById('open-create-room').addEventListener('click', () => {
    clearRoomsError();
    document.getElementById('create-room-error').hidden = true;
    createRoomDialog.showModal();
    document.getElementById('create-room-name').focus();
});

function closeCreateRoomDialog() {
    createRoomDialog.close();
}

document.getElementById('close-create-room').addEventListener('click', closeCreateRoomDialog);
document.getElementById('cancel-create-room').addEventListener('click', closeCreateRoomDialog);
document.getElementById('create-room-mode').addEventListener('change', () => {
    syncDeathmatchNotebooks('create-room-mode', 'create-room-notebooks');
});
document.getElementById('lobby-mode').addEventListener('change', () => {
    syncDeathmatchNotebooks('lobby-mode', 'lobby-notebooks');
});

createRoomForm.addEventListener('submit', event => {
    event.preventDefault();
    const errorElement = document.getElementById('create-room-error');
    errorElement.hidden = true;
    const submitButton = document.getElementById('submit-create-room');
    submitButton.disabled = true;
    try {
        websocketClient
            .createRoom(getRoomSettings(createRoomForm))
            .then(snapshot => {
                closeCreateRoomDialog();
                showLobby(snapshot.payload);
            })
            .catch(error => {
                errorElement.textContent = error.message || 'Não foi possível criar a sala.';
                errorElement.hidden = false;
            })
            .finally(() => {
                submitButton.disabled = false;
            });
    } catch (error) {
        errorElement.textContent = error.message || 'Não foi possível criar a sala.';
        errorElement.hidden = false;
        submitButton.disabled = false;
    }
});

lobbyConfigForm.addEventListener('submit', event => {
    event.preventDefault();
    clearLobbyError();
    const saveButton = document.getElementById('save-lobby-config');
    saveButton.disabled = true;
    websocketClient
        .configureRoom(getRoomSettings(lobbyConfigForm))
        .then(snapshot => showLobby(snapshot.payload))
        .catch(error => setLobbyError(error.message || 'Não foi possível atualizar a sala.'))
        .finally(() => {
            saveButton.disabled = false;
        });
});

document.getElementById('start-match').addEventListener('click', event => {
    clearLobbyError();
    event.currentTarget.disabled = true;
    websocketClient.startMatch().catch(error => {
        setLobbyError(error.message || 'Não foi possível iniciar a partida.');
        event.currentTarget.disabled = false;
    });
});

document.getElementById('leave-room').addEventListener('click', event => {
    event.currentTarget.disabled = true;
    websocketClient.leaveRoom().catch(error => {
        setLobbyError(error.message || 'Não foi possível sair da sala.');
        event.currentTarget.disabled = false;
    });
});

for (const input of characterInputs) {
    input.addEventListener('focus', () => {
        input.closest('.character-choice').scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
}

const storedProfile = loadProfile();
if (storedProfile) {
    applyProfileToForm(storedProfile);
    setScreen('home', storedProfile);
    connectWebSocket(storedProfile);
} else {
    setScreen('profile');
}
