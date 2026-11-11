import { formatRoomMode, roomTimeLabel } from '../rooms/room-format.js';
import { readRoomSettings, syncDeathmatchNotebooks } from '../rooms/room-settings-form.js';

export function createLobbyFeature({ getClient, onRoomSnapshot, documentRef = document }) {
    const lobbyConfigForm = documentRef.getElementById('lobby-config-form');
    const lobbyError = documentRef.getElementById('lobby-error');

    function setLobbyError(message) {
        lobbyError.textContent = message;
        lobbyError.hidden = false;
    }

    function clearLobbyError() {
        lobbyError.textContent = '';
        lobbyError.hidden = true;
    }

    function setFormValue(id, value) {
        documentRef.getElementById(id).value = value;
    }

    function render(snapshot, profile) {
        const { room, participants } = snapshot;
        const isOwner = room.owner_id === profile?.user_id;
        const isWaiting = room.status === 'waiting';
        documentRef.getElementById('lobby-title').textContent = isWaiting
            ? 'AGUARDANDO JOGADORES'
            : 'PARTIDA EM ANDAMENTO';
        documentRef.getElementById('lobby-status').lastChild.textContent = isWaiting
            ? ' AGUARDANDO'
            : ' EM JOGO';
        documentRef.getElementById('lobby-room-name').textContent = room.name;
        documentRef.getElementById('lobby-room-mode').textContent = formatRoomMode(room.mode);
        documentRef.getElementById('lobby-room-floors').textContent = String(room.floors).padStart(
            2,
            '0'
        );
        documentRef.getElementById('lobby-room-notebooks').textContent = String(
            room.notebooks_per_floor
        ).padStart(2, '0');
        documentRef.getElementById('lobby-room-time').textContent = roomTimeLabel(
            room.time_limit_seconds
        );
        documentRef.getElementById('lobby-room-capacity').textContent =
            `${String(participants.length).padStart(2, '0')} / ${String(room.max_players).padStart(2, '0')}`;
        documentRef.getElementById('participant-count').textContent = String(
            participants.length
        ).padStart(2, '0');

        const participantList = documentRef.getElementById('participant-list');
        participantList.replaceChildren();
        for (const participant of participants) {
            const item = documentRef.createElement('div');
            item.className = `participant-item${participant.user_id === room.owner_id ? ' participant-item--owner' : ''}`;
            const name = documentRef.createElement('span');
            name.className = 'participant-name';
            name.textContent = participant.nickname;
            const state = documentRef.createElement('span');
            state.className =
                participant.user_id === room.owner_id
                    ? 'participant-badge'
                    : 'participant-connection';
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
        documentRef.getElementById('start-match').disabled = !isOwner || !isWaiting;
        if (isOwner && isWaiting && !lobbyConfigForm.matches(':focus-within')) {
            setFormValue('lobby-name', room.name);
            setFormValue('lobby-mode', room.mode);
            setFormValue('lobby-floors', room.floors);
            setFormValue('lobby-notebooks', room.notebooks_per_floor);
            setFormValue('lobby-time', room.time_limit_seconds ?? '');
            setFormValue('lobby-max-players', room.max_players);
            syncDeathmatchNotebooks('lobby-mode', 'lobby-notebooks', documentRef);
        }
    }

    lobbyConfigForm.addEventListener('submit', event => {
        event.preventDefault();
        clearLobbyError();
        const saveButton = documentRef.getElementById('save-lobby-config');
        saveButton.disabled = true;
        getClient()
            .configureRoom(readRoomSettings(lobbyConfigForm))
            .then(snapshot => onRoomSnapshot(snapshot.payload))
            .catch(error => setLobbyError(error.message || 'Não foi possível atualizar a sala.'))
            .finally(() => {
                saveButton.disabled = false;
            });
    });

    documentRef.getElementById('lobby-mode').addEventListener('change', () => {
        syncDeathmatchNotebooks('lobby-mode', 'lobby-notebooks', documentRef);
    });
    documentRef.getElementById('start-match').addEventListener('click', event => {
        clearLobbyError();
        event.currentTarget.disabled = true;
        getClient()
            .startMatch()
            .catch(error => {
                setLobbyError(error.message || 'Não foi possível iniciar a partida.');
                event.currentTarget.disabled = false;
            });
    });
    documentRef.getElementById('leave-room').addEventListener('click', event => {
        event.currentTarget.disabled = true;
        getClient()
            .leaveRoom()
            .catch(error => {
                setLobbyError(error.message || 'Não foi possível sair da sala.');
                event.currentTarget.disabled = false;
            });
    });

    return { clearLobbyError, render, setLobbyError };
}
