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
let websocketClient;

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
        websocketClient.listRooms().catch(() => {});
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
