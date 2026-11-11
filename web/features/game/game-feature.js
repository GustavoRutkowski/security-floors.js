import { createTopDownGame } from './game-scene.js';

export function createGameFeature({ documentRef = document }) {
    const gameRoot = documentRef.getElementById('game-root');
    let topDownGame;

    function hide() {
        topDownGame?.destroy();
        topDownGame = undefined;
    }

    function show({ snapshot, client, profile, room }) {
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

    return { hide, show, updateMovement, showSpectatorNote };
}
