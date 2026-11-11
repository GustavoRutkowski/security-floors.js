import '@fontsource/press-start-2p';
import './style.css';
import { createGameFeature } from './features/game/game-feature.js';
import { createLobbyFeature } from './features/lobby/lobby-feature.js';
import { createProfileFeature } from './features/profile/profile-feature.js';
import { createRoomsFeature } from './features/rooms/rooms-feature.js';
import { createAppState } from './state/app-state.js';
import { loadProfile } from './services/profile-storage.js';
import { WebSocketClient } from './services/websocket-client.js';

const state = createAppState();
const profileScreen = document.getElementById('profile-screen');
const homeScreen = document.getElementById('home-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
let websocketClient;

function renderScreen({ screen }) {
    profileScreen.hidden = screen !== 'profile';
    homeScreen.hidden = screen !== 'home';
    lobbyScreen.hidden = screen !== 'lobby';
    gameScreen.hidden = screen !== 'game';
    document.documentElement.dataset.screen = screen;
}

state.subscribe(renderScreen);

function updateConnectionStatus(status, message = null) {
    const labels = {
        disconnected: 'DESCONECTADO',
        connecting: 'CONECTANDO',
        open: 'AUTENTICANDO',
        ready: 'ONLINE',
        reconnecting: 'RECONEXÃO',
        closed: 'DESCONECTADO'
    };
    state.update({ connectionStatus: status });
    document.getElementById('system-status').textContent = message || labels[status] || status;
    document.getElementById('footer-state').textContent = `WS / ${labels[status] || status}`;
}

function setLocalScreenStatus(screenName) {
    const showHome = screenName === 'home';
    document.getElementById('system-status').textContent = showHome
        ? 'PERFIL ATIVO'
        : 'PERFIL LOCAL';
    document.getElementById('footer-state').textContent = showHome
        ? 'CLIENTE LOCAL / HOME'
        : 'CLIENTE LOCAL / PERFIL';
}

function setScreen(screen) {
    state.update({ screen });
}

function getWebSocketUrl() {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:3001`;
}

function showLobby(snapshot) {
    roomsFeature.stopRoomPolling();
    gameFeature.hide();
    state.update({
        screen: 'lobby',
        selectedRoomId: snapshot.room.room_id,
        roomSnapshot: snapshot,
        matchSnapshot: null
    });
    lobbyFeature.render(snapshot, state.getState().profile);
}

function showGame(snapshot = state.getState().matchSnapshot) {
    roomsFeature.stopRoomPolling();
    const currentState = state.getState();
    state.update({ screen: 'game', matchSnapshot: snapshot ?? currentState.matchSnapshot });
    gameFeature.show({
        snapshot: snapshot ?? currentState.matchSnapshot,
        client: websocketClient,
        profile: currentState.profile,
        room: currentState.roomSnapshot?.room
    });
}

function showHome(message = null) {
    gameFeature.hide();
    state.update({
        screen: 'home',
        selectedRoomId: null,
        roomSnapshot: null,
        matchSnapshot: null
    });
    setLocalScreenStatus('home');
    if (message) document.getElementById('lobby-message').textContent = message;
    if (websocketClient?.status === 'ready') {
        roomsFeature.refreshRooms();
        roomsFeature.startRoomPolling();
    }
}

function onProfileReady(profile) {
    state.update({ profile, screen: 'home' });
    setLocalScreenStatus('home');
    connectWebSocket(profile);
}

function onEditProfile() {
    roomsFeature.stopRoomPolling();
    websocketClient?.close();
    websocketClient = undefined;
    setScreen('profile');
    setLocalScreenStatus('profile');
}

const profileFeature = createProfileFeature({
    onProfileReady,
    onEditProfile
});
const gameFeature = createGameFeature();
const lobbyFeature = createLobbyFeature({
    getClient: () => websocketClient,
    onRoomSnapshot: showLobby
});
const roomsFeature = createRoomsFeature({
    getClient: () => websocketClient,
    getState: state.getState,
    updateState: state.update,
    onRoomReady: showLobby
});

function connectWebSocket(profile) {
    websocketClient?.close();
    try {
        websocketClient = new WebSocketClient({ url: getWebSocketUrl(), profile });
    } catch (error) {
        updateConnectionStatus('disconnected', 'WS INDISPONÍVEL');
        profileFeature.showError(error.message);
        return;
    }

    websocketClient.addEventListener('status', event => {
        updateConnectionStatus(event.detail.status);
    });
    websocketClient.addEventListener('session.ready', () => {
        if (state.getState().roomSnapshot) return;
        roomsFeature.refreshRooms();
        roomsFeature.startRoomPolling();
    });
    websocketClient.addEventListener('room.snapshot', event => {
        const snapshot = event.detail.payload;
        if (snapshot.room.status === 'playing') {
            state.update({
                selectedRoomId: snapshot.room.room_id,
                roomSnapshot: snapshot
            });
            return;
        }
        showLobby(snapshot);
    });
    websocketClient.addEventListener('room.left', () => showHome('VOCÊ SAIU DA SALA'));
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
        const currentMatchSnapshot = state.getState().matchSnapshot;
        const player = currentMatchSnapshot?.players.find(
            candidate => candidate.user_id === movement.user_id
        );
        const updatedPlayer = {
            user_id: movement.user_id,
            nickname: movement.nickname ?? player?.nickname,
            character_id: movement.character_id ?? player?.character_id,
            x: movement.x,
            y: movement.y,
            direction: movement.direction,
            floor: player?.floor ?? 1,
            status: player?.status ?? 'playing'
        };
        if (currentMatchSnapshot) {
            const players = currentMatchSnapshot.players.filter(
                candidate => candidate.user_id !== movement.user_id
            );
            state.update({
                matchSnapshot: { ...currentMatchSnapshot, players: [...players, updatedPlayer] }
            });
        }
        gameFeature.updateMovement(updatedPlayer);
    });
    websocketClient.addEventListener('spectator.started', event => {
        const target = event.detail.payload.target_user_id;
        gameFeature.showSpectatorNote(
            target
                ? `VOCÊ FOI ELIMINADO. ACOMPANHANDO ${target}.`
                : 'VOCÊ FOI ELIMINADO. NÃO HÁ JOGADORES ATIVOS PARA ACOMPANHAR.'
        );
    });
    websocketClient.addEventListener('spectator.following', event => {
        gameFeature.showSpectatorNote(`ACOMPANHANDO ${event.detail.payload.target_user_id}.`);
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

const storedProfile = loadProfile();
if (storedProfile) {
    profileFeature.applyProfile(storedProfile);
    state.update({ profile: storedProfile, screen: 'home' });
    setLocalScreenStatus('home');
    connectWebSocket(storedProfile);
} else {
    setScreen('profile');
    setLocalScreenStatus('profile');
}
