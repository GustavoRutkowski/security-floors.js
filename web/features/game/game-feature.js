import { createTopDownGame } from './game-scene.js';
import { DEFAULT_CHARACTER_ID, getCharacter } from '../../services/character-catalog.js';
import { getCharacterSpriteUrl } from '../../services/character-assets.js';

export function createGameFeature({ documentRef = document } = {}) {
    const gameRoot = documentRef.getElementById('game-root');
    let topDownGame;
    let timerInterval;

    function renderProfile(profile) {
        if (!profile) return;
        const character = getCharacter(profile.character_id) ?? getCharacter(DEFAULT_CHARACTER_ID);
        const sprite = documentRef.getElementById('game-character');
        documentRef.getElementById('game-nickname').textContent = profile.nickname;
        documentRef.getElementById('game-character-name').textContent = character.name;
        sprite.dataset.character = character.id;
        sprite.style.backgroundImage = `url("${getCharacterSpriteUrl(character)}")`;
    }

    function renderTimer(deadline, timeLimit) {
        const timer = documentRef.getElementById('game-timer');
        if (timeLimit == null) {
            timer.textContent = '∞';
            return;
        }

        const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function updateRanking(entries = []) {
        const list = documentRef.getElementById('ranking-list');
        documentRef.getElementById('ranking-count').textContent = String(entries.length).padStart(
            2,
            '0'
        );
        list.replaceChildren();
        if (entries.length === 0) {
            const empty = documentRef.createElement('li');
            empty.className = 'ranking-empty';
            empty.textContent = 'AGUARDANDO PLACAR';
            list.append(empty);
            return;
        }

        for (const entry of entries) {
            const row = documentRef.createElement('li');
            row.className = 'ranking-entry';
            const rank = documentRef.createElement('span');
            rank.className = 'ranking-position';
            rank.textContent = `#${String(entry.rank).padStart(2, '0')}`;
            const nickname = documentRef.createElement('span');
            nickname.className = 'ranking-nickname';
            nickname.textContent = entry.nickname;
            const floor = documentRef.createElement('span');
            floor.className = 'ranking-floor';
            floor.textContent = `F${String(entry.floor).padStart(2, '0')}`;
            row.append(rank, nickname, floor);
            list.append(row);
        }
    }

    function hide() {
        topDownGame?.destroy();
        topDownGame = undefined;
        globalThis.clearInterval(timerInterval);
        timerInterval = undefined;
    }

    function show({ snapshot, client, profile, room, deadline }) {
        renderProfile(profile);
        renderTimer(deadline, room?.time_limit_seconds);
        updateRanking(snapshot?.entries);
        if (timerInterval === undefined && room?.time_limit_seconds != null) {
            timerInterval = globalThis.setInterval(
                () => renderTimer(deadline, room.time_limit_seconds),
                1000
            );
        }
        if (topDownGame) {
            if (snapshot) topDownGame.applySnapshot(snapshot);
            return;
        }

        topDownGame = createTopDownGame({
            root: gameRoot,
            client,
            profile,
            snapshot,
            room,
            onHudUpdate: ({ floor, status }) => {
                documentRef.getElementById('game-floor').textContent = String(floor).padStart(
                    2,
                    '0'
                );
                documentRef.getElementById('game-player-status').textContent = status;
            }
        });
    }

    function updateMovement(movement) {
        topDownGame?.updateMovement(movement);
    }

    function showSpectatorNote(message) {
        const note = documentRef.getElementById('spectator-note');
        note.textContent = message;
        note.hidden = false;
    }

    return { hide, show, updateMovement, updateRanking, showSpectatorNote };
}
