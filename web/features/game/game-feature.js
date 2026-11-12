import { createTopDownGame } from './game-scene.js';
import { DEFAULT_CHARACTER_ID, getCharacter } from '../../services/character-catalog.js';
import { getCharacterSpriteUrl } from '../../services/character-assets.js';

const SPECTATOR_HINT = 'USE ← / → PARA TROCAR DE JOGADOR';
const MATCH_END_REASONS = {
    all_players_finished: 'TODOS CONCLUÍRAM A RUN',
    last_player_disconnected: 'VITÓRIA POR DESCONEXÃO DOS ADVERSÁRIOS',
    last_player_standing: 'ÚLTIMO JOGADOR ATIVO',
    no_players_remaining: 'NÃO RESTARAM JOGADORES',
    questions_exhausted: 'TODOS OS COMPETIDORES CONCLUÍRAM',
    time_limit_reached: 'TEMPO ESGOTADO'
};
const RESULTS_TIMEOUT_MS = 8000;

export function createGameFeature({ documentRef = document } = {}) {
    const gameRoot = documentRef.getElementById('game-root');
    const spectatorHud = documentRef.getElementById('spectator-hud');
    const spectatorTarget = documentRef.getElementById('spectator-target');
    const spectatorControls = documentRef.getElementById('spectator-controls');
    const resultsDialog = documentRef.getElementById('match-results-dialog');
    const resultsReason = documentRef.getElementById('match-results-reason');
    const resultsList = documentRef.getElementById('match-results-list');
    const resultsCountdown = documentRef.getElementById('match-results-countdown');
    const resultsConfirm = documentRef.getElementById('match-results-confirm');
    let topDownGame;
    let timerInterval;
    let resultsTimeout;
    let resultsInterval;
    let resultsDismissCallback;
    let resultsOpenedAt;
    let currentQuestion;
    let presentedQuestions = new Map();
    let answerResult;
    let rankingEntries = [];
    let spectatorStatus = 'playing';
    let spectatorTargetUserId = null;

    function dismissResults() {
        if (!resultsDialog.open) return;
        globalThis.clearTimeout(resultsTimeout);
        globalThis.clearInterval(resultsInterval);
        resultsTimeout = undefined;
        resultsInterval = undefined;
        resultsDialog.close();
        const callback = resultsDismissCallback;
        resultsDismissCallback = undefined;
        callback?.();
    }

    function renderResultsCountdown() {
        const remainingSeconds = Math.max(
            0,
            Math.ceil((RESULTS_TIMEOUT_MS - (Date.now() - resultsOpenedAt)) / 1000)
        );
        resultsCountdown.textContent = `VOLTANDO À SALA EM ${remainingSeconds}S`;
    }

    function showResults({ reason, entries }, onDismiss) {
        resultsReason.textContent = MATCH_END_REASONS[reason] ?? 'PARTIDA ENCERRADA';
        resultsList.replaceChildren();
        for (const entry of entries) {
            const row = documentRef.createElement('li');
            row.className = 'match-results-entry';

            const position = documentRef.createElement('span');
            position.className = 'match-results-position';
            position.textContent = `#${String(entry.rank).padStart(2, '0')}`;

            const nickname = documentRef.createElement('span');
            nickname.className = 'match-results-nickname';
            nickname.textContent = entry.nickname;

            const detail = documentRef.createElement('span');
            detail.className = 'match-results-detail';
            detail.textContent = `F${String(entry.floor).padStart(2, '0')} / ${
                entry.status === 'finished'
                    ? 'CONCLUÍDO'
                    : entry.status === 'eliminated'
                      ? 'ELIMINADO'
                      : 'EM JOGO'
            }`;

            row.append(position, nickname, detail);
            resultsList.append(row);
        }

        resultsDismissCallback = onDismiss;
        resultsOpenedAt = Date.now();
        renderResultsCountdown();
        resultsDialog.showModal();
        resultsInterval = globalThis.setInterval(renderResultsCountdown, 1000);
        resultsTimeout = globalThis.setTimeout(dismissResults, RESULTS_TIMEOUT_MS);
    }

    resultsConfirm.addEventListener('click', dismissResults);
    resultsDialog.addEventListener('cancel', event => event.preventDefault());

    function renderSpectatorHud() {
        const watching = spectatorStatus !== 'playing';
        spectatorHud.hidden = !watching;
        if (!watching) return;

        const target = rankingEntries.find(entry => entry.user_id === spectatorTargetUserId);
        spectatorTarget.textContent = spectatorTargetUserId
            ? `ESPECTANDO: ${target?.nickname ?? spectatorTargetUserId}`
            : 'NENHUM JOGADOR ATIVO';
    }

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
        rankingEntries = entries;
        renderSpectatorHud();
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
        topDownGame?.updateRanking(entries);
    }

    function hide() {
        topDownGame?.destroy();
        topDownGame = undefined;
        currentQuestion = undefined;
        presentedQuestions = new Map();
        answerResult = undefined;
        rankingEntries = [];
        spectatorStatus = 'playing';
        spectatorTargetUserId = null;
        spectatorHud.hidden = true;
        spectatorControls.textContent = SPECTATOR_HINT;
        globalThis.clearInterval(timerInterval);
        timerInterval = undefined;
    }

    function show({ snapshot, client, profile, room, deadline }) {
        if (snapshot?.viewer) {
            spectatorStatus = snapshot.viewer.status;
            spectatorTargetUserId = snapshot.viewer.target_user_id;
        }
        renderSpectatorHud();
        renderProfile(profile);
        renderTimer(deadline, room?.time_limit_seconds);
        if (snapshot?.entries) updateRanking(snapshot.entries);
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
            question: currentQuestion,
            questions: [...presentedQuestions.values()],
            answerResult,
            rankingEntries,
            onHudUpdate: ({ floor, status }) => {
                documentRef.getElementById('game-floor').textContent = String(floor).padStart(
                    2,
                    '0'
                );
                documentRef.getElementById('game-player-status').textContent = status;
            },
            onSpectatorError: message => {
                spectatorControls.textContent = message;
            }
        });
    }

    function updateMovement(movement) {
        topDownGame?.updateMovement(movement);
    }

    function showQuestion(question) {
        currentQuestion = question;
        if (presentedQuestions.size > 0 && !presentedQuestions.has(question.notebook_id)) {
            const currentFloor = presentedQuestions.values().next().value.floor;
            if (currentFloor !== question.floor) presentedQuestions.clear();
        }
        presentedQuestions.set(question.notebook_id, question);
        answerResult = undefined;
        topDownGame?.showQuestion(question);
    }

    function showAnswerResult(result) {
        answerResult = result;
        topDownGame?.showAnswerResult(result);
    }

    function showDoorOpened(event) {
        topDownGame?.showDoorOpened(event);
    }

    function setSpectatorMode(options) {
        spectatorStatus = options.status;
        spectatorTargetUserId = options.targetUserId;
        spectatorControls.textContent = SPECTATOR_HINT;
        renderSpectatorHud();
        topDownGame?.setSpectatorMode(options);
    }

    function setSpectatorTarget(targetUserId) {
        spectatorTargetUserId = targetUserId;
        spectatorControls.textContent = SPECTATOR_HINT;
        renderSpectatorHud();
        topDownGame?.setSpectatorTarget(targetUserId);
    }

    return {
        hide,
        show,
        updateMovement,
        updateRanking,
        showQuestion,
        showAnswerResult,
        showDoorOpened,
        setSpectatorMode,
        setSpectatorTarget,
        showResults
    };
}
