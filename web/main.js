import '@fontsource/press-start-2p';
import './style.css';
import { CHARACTERS, loadProfile, saveProfile } from './profile.js';
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
let websocketClient;
let roomPollingTimer;
let selectedRoomId;

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
        refreshRooms();
        startRoomPolling();
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
