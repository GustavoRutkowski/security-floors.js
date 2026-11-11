import { formatRoomMode } from './room-format.js';
import { readRoomSettings, syncDeathmatchNotebooks } from './room-settings-form.js';

export function createRoomsFeature({
    getClient,
    getState,
    updateState,
    onRoomReady,
    documentRef = document
}) {
    const refreshRoomsButton = documentRef.getElementById('refresh-rooms');
    const roomList = documentRef.getElementById('room-list');
    const roomsStatus = documentRef.getElementById('rooms-status');
    const roomsError = documentRef.getElementById('rooms-error');
    const createRoomDialog = documentRef.getElementById('create-room-dialog');
    const createRoomForm = documentRef.getElementById('create-room-form');
    let roomPollingTimer;

    function showRoomsError(message) {
        roomsError.textContent = message;
        roomsError.hidden = false;
    }

    function clearRoomsError() {
        roomsError.hidden = true;
        roomsError.textContent = '';
    }

    function renderRooms(rooms) {
        roomList.replaceChildren();
        if (rooms.length === 0) {
            const emptyState = documentRef.createElement('p');
            emptyState.className = 'room-empty';
            emptyState.textContent = 'NENHUMA SALA AGUARDANDO JOGADORES';
            roomList.append(emptyState);
            return;
        }

        for (const room of rooms) {
            const selectedRoomId = getState().selectedRoomId;
            const card = documentRef.createElement('article');
            card.className = `room-card${room.room_id === selectedRoomId ? ' room-card--selected' : ''}`;

            const info = documentRef.createElement('div');
            info.className = 'room-card-info';
            const name = documentRef.createElement('strong');
            name.className = 'room-card-name';
            name.textContent = room.name;
            const meta = documentRef.createElement('p');
            meta.className = 'room-card-meta';
            const mode = documentRef.createElement('span');
            const modeLabel = documentRef.createElement('strong');
            modeLabel.textContent = formatRoomMode(room.mode);
            mode.append(modeLabel);
            const players = documentRef.createElement('span');
            players.textContent = `${room.player_count} / ${room.max_players} JOGADORES`;
            const floors = documentRef.createElement('span');
            floors.textContent = `${room.floors} ANDARES`;
            meta.append(mode, players, floors);
            info.append(name, meta);

            const joinButton = documentRef.createElement('button');
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
        const client = getClient();
        if (!client || client.status !== 'ready') {
            roomsStatus.textContent = 'AGUARDANDO CONEXÃO';
            return Promise.resolve();
        }

        refreshRoomsButton.disabled = true;
        roomsStatus.textContent = 'BUSCANDO SALAS...';
        clearRoomsError();
        return client
            .listRooms()
            .then(response => {
                const rooms = response.payload?.rooms;
                if (!Array.isArray(rooms)) throw new Error('A lista de salas recebida é inválida.');
                updateState({ rooms });
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
        const client = getClient();
        if (!client || client.status !== 'ready') return;
        button.disabled = true;
        button.textContent = 'ENTRANDO...';
        clearRoomsError();
        roomsStatus.textContent = `ENTRANDO EM ${room.name.toUpperCase()}...`;
        client
            .joinRoom(room.room_id)
            .then(snapshot => {
                updateState({ selectedRoomId: snapshot.payload.room.room_id });
                roomsStatus.textContent = `SALA CONECTADA / ${snapshot.payload.room.name}`;
                renderRooms([room]);
                onRoomReady(snapshot.payload);
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

    function closeCreateRoomDialog() {
        createRoomDialog.close();
    }

    refreshRoomsButton.addEventListener('click', refreshRooms);
    documentRef.getElementById('open-create-room').addEventListener('click', () => {
        clearRoomsError();
        documentRef.getElementById('create-room-error').hidden = true;
        createRoomDialog.showModal();
        documentRef.getElementById('create-room-name').focus();
    });
    documentRef
        .getElementById('close-create-room')
        .addEventListener('click', closeCreateRoomDialog);
    documentRef
        .getElementById('cancel-create-room')
        .addEventListener('click', closeCreateRoomDialog);
    documentRef.getElementById('create-room-mode').addEventListener('change', () => {
        syncDeathmatchNotebooks('create-room-mode', 'create-room-notebooks', documentRef);
    });

    createRoomForm.addEventListener('submit', event => {
        event.preventDefault();
        const errorElement = documentRef.getElementById('create-room-error');
        errorElement.hidden = true;
        const submitButton = documentRef.getElementById('submit-create-room');
        submitButton.disabled = true;
        try {
            getClient()
                .createRoom(readRoomSettings(createRoomForm))
                .then(snapshot => {
                    closeCreateRoomDialog();
                    onRoomReady(snapshot.payload);
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

    return { refreshRooms, renderRooms, startRoomPolling, stopRoomPolling };
}
