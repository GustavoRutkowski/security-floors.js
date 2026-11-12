import Phaser from 'phaser';
import { CHARACTERS } from '../../services/character-catalog.js';
import { getCharacterSpriteUrl } from '../../services/character-assets.js';
import { getDoorTiles, getTileAt, isNearTile, MAP_SIZE } from '../../../map-layout.js';

const TILE_SIZE = 32;
const WORLD_SIZE = MAP_SIZE * TILE_SIZE;
const LOGICAL_MAP_SIZE = 100;
const GAME_VIEW_SIZE = 480;
const MOVE_INTERVAL_MS = 85;
const NOTEBOOK_INTERACTION_RANGE = 8;
const DOOR_ANIMATION_STAGE_MS = 250;
const SPECTATOR_VIEW_TILES = 5;
const PIXEL_FONT = "'Press Start 2P', monospace";
const CHARACTER_IDS = CHARACTERS.map(character => character.id);
const TILESET_KEY = 'tileset';
const TILESET_URL = '/spritesheets/TILESET.png';

function logicalToWorld(value) {
    return (value / LOGICAL_MAP_SIZE) * WORLD_SIZE;
}

function getDirection(cursors, keys) {
    const horizontal =
        (cursors?.left?.isDown || keys?.a?.isDown ? -1 : 0) +
        (cursors?.right?.isDown || keys?.d?.isDown ? 1 : 0);
    const vertical =
        (cursors?.up?.isDown || keys?.w?.isDown ? -1 : 0) +
        (cursors?.down?.isDown || keys?.s?.isDown ? 1 : 0);
    if (horizontal === 0 && vertical === 0) return 'stop';
    if (vertical < 0 && horizontal < 0) return 'northwest';
    if (vertical < 0 && horizontal > 0) return 'northeast';
    if (vertical > 0 && horizontal < 0) return 'southwest';
    if (vertical > 0 && horizontal > 0) return 'southeast';
    if (vertical < 0) return 'north';
    if (vertical > 0) return 'south';
    return horizontal < 0 ? 'west' : 'east';
}

class TopDownScene extends Phaser.Scene {
    constructor(onHudUpdate, onSpectatorError) {
        super('top-down-scene');
        this.players = new Map();
        this.latestSnapshot = null;
        this.client = null;
        this.profile = null;
        this.sequence = 0;
        this.lastDirection = 'stop';
        this.lastMoveAt = 0;
        this.controlsEnabled = true;
        this.ready = false;
        this.pendingMovements = new Map();
        this.onHudUpdate = onHudUpdate;
        this.onSpectatorError = onSpectatorError;
        this.availableQuestions = new Map();
        this.rankingEntries = [];
        this.notebooksPerFloor = 1;
        this.localPlayer = null;
        this.viewerStatus = 'playing';
        this.spectatorMode = false;
        this.spectatorTargetId = null;
        this.pendingSpectatorTargetId = null;
        this.currentQuestion = null;
        this.answerResult = null;
        this.questionError = null;
        this.questionState = 'closed';
        this.selectedQuestionItem = 0;
        this.questionUiObjects = [];
        this.interactionHint = null;
        this.interactionHintText = '';
        this.doorTiles = [];
        this.doorIsOpen = false;
        this.doorAnimationTimer = null;
        this.answeredNotebooks = [];
        this.noticeText = '';
    }

    init(data) {
        this.client = data.client;
        this.profile = data.profile;
        this.latestSnapshot = data.snapshot;
        this.notebooksPerFloor = data.room?.notebooks_per_floor ?? 1;
        this.currentQuestion = data.question ?? null;
        for (const question of data.questions ?? []) {
            this.availableQuestions.set(question.notebook_id, question);
        }
        if (this.currentQuestion) {
            this.availableQuestions.set(this.currentQuestion.notebook_id, this.currentQuestion);
        }
        this.answerResult = data.answerResult ?? null;
        this.rankingEntries = data.rankingEntries ?? [];
        this.answeredNotebooks = data.answeredNotebooks ?? [];
        this.viewerStatus = data.snapshot?.viewer?.status ?? 'playing';
        this.spectatorMode = this.viewerStatus !== 'playing';
        this.spectatorTargetId = data.snapshot?.viewer?.target_user_id ?? null;
        this.doorIsOpen = Boolean(
            data.snapshot?.players?.find(player => player.user_id === data.profile.user_id)
                ?.door_open
        );
        this.questionState = this.answerResult ? 'feedback' : 'closed';
    }

    preload() {
        this.load.spritesheet(TILESET_KEY, TILESET_URL, {
            frameWidth: 16,
            frameHeight: 16
        });
        for (const character of CHARACTERS) {
            this.load.spritesheet(character.id, getCharacterSpriteUrl(character), {
                frameWidth: 16,
                frameHeight: 16
            });
        }
    }

    create() {
        this.createMap();
        this.createAnimations();
        if (this.doorIsOpen) this.setDoorFrameSet(15);
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.keys = this.input.keyboard.addKeys('W,A,S,D');
            this.interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
            this.cancelKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        } else {
            this.controlsEnabled = false;
        }
        this.baseCameraZoom = Math.min(
            this.scale.width / WORLD_SIZE,
            this.scale.height / WORLD_SIZE
        );
        this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
        this.cameras.main.setZoom(this.baseCameraZoom);
        this.ready = true;
        this.applySnapshot(this.latestSnapshot);
        for (const movement of this.pendingMovements.values()) this.updatePlayer(movement);
        this.pendingMovements.clear();
        this.interactionHint = this.add
            .text(this.scale.width / 2, this.scale.height - 18, '', {
                backgroundColor: '#172226',
                color: '#c8f58f',
                fontFamily: PIXEL_FONT,
                fontSize: '7px',
                padding: { x: 8, y: 6 }
            })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(20000)
            .setVisible(false);
        if (this.questionState !== 'closed') this.renderQuestionMenu();
        this.scale.on('resize', this.resizeCamera, this);
    }

    createMap() {
        for (let row = 0; row < MAP_SIZE; row += 1) {
            for (let column = 0; column < MAP_SIZE; column += 1) {
                const tile = getTileAt(this.notebooksPerFloor, row, column);
                this.addTile(column, row, 0);
                if (tile.type.name === 'wall') this.addTile(column, row, 1);
                if (tile.type.name === 'table') this.addTile(column, row, 2);
            }
        }

        this.doorTiles = getDoorTiles(this.notebooksPerFloor).map(({ row, column }, index) => ({
            row,
            column,
            image: this.addTile(column, row, 3 + index, 2)
        }));
    }

    addTile(column, row, frame, depth = 0) {
        return this.add
            .image(
                column * TILE_SIZE + TILE_SIZE / 2,
                row * TILE_SIZE + TILE_SIZE / 2,
                TILESET_KEY,
                frame
            )
            .setScale(2)
            .setDepth(depth);
    }

    setDoorFrameSet(firstFrame) {
        for (const [index, tile] of this.doorTiles.entries()) {
            tile.image.setFrame(firstFrame + index);
        }
    }

    openDoor() {
        if (this.doorAnimationTimer) {
            this.doorAnimationTimer.remove();
            this.doorAnimationTimer = null;
        }
        this.doorIsOpen = true;
        this.setDoorFrameSet(9);
        this.doorAnimationTimer = this.time.delayedCall(DOOR_ANIMATION_STAGE_MS, () => {
            this.setDoorFrameSet(15);
            this.doorAnimationTimer = null;
        });
    }

    closeDoor() {
        if (this.doorAnimationTimer) {
            this.doorAnimationTimer.remove();
            this.doorAnimationTimer = null;
        }
        this.doorIsOpen = false;
        this.setDoorFrameSet(3);
    }

    updateRanking(entries) {
        this.rankingEntries = entries;
    }

    setSpectatorMode({ status = 'eliminated', targetUserId = null } = {}) {
        this.viewerStatus = status;
        this.spectatorMode = true;
        this.spectatorTargetId = targetUserId;
        this.controlsEnabled = false;
        this.questionState = 'closed';
        this.currentQuestion = null;
        this.answerResult = null;
        this.clearQuestionMenu();
        this.updateViewerHud();
        this.focusSpectatorTarget();
    }

    setSpectatorTarget(targetUserId) {
        this.spectatorTargetId = targetUserId;
        this.pendingSpectatorTargetId = null;
        this.focusSpectatorTarget();
    }

    focusSpectatorTarget() {
        if (!this.spectatorMode) return;
        const camera = this.cameras.main;
        if (!this.spectatorTargetId) {
            camera.stopFollow();
            camera.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
            camera.setZoom(this.baseCameraZoom);
            return;
        }
        const targetView = this.players.get(this.spectatorTargetId);
        if (!targetView) return;

        const zoom = this.baseCameraZoom * (MAP_SIZE / SPECTATOR_VIEW_TILES);
        const halfViewSize = WORLD_SIZE / (2 * (MAP_SIZE / SPECTATOR_VIEW_TILES));
        camera.stopFollow();
        camera.setBounds(
            -halfViewSize,
            -halfViewSize,
            WORLD_SIZE + halfViewSize * 2,
            WORLD_SIZE + halfViewSize * 2
        );
        camera.setZoom(zoom);
        camera.startFollow(targetView.sprite, true, 1, 1);
    }

    moveSpectatorTarget(direction) {
        const targets = this.rankingEntries.filter(
            entry => entry.status === 'playing' && entry.user_id !== this.profile.user_id
        );
        if (targets.length === 0 || !this.client) return;

        const currentIndex = targets.findIndex(
            entry => entry.user_id === (this.pendingSpectatorTargetId ?? this.spectatorTargetId)
        );
        const nextIndex =
            currentIndex === -1
                ? direction > 0
                    ? 0
                    : targets.length - 1
                : (currentIndex + direction + targets.length) % targets.length;
        const targetUserId = targets[nextIndex].user_id;
        if (targetUserId === this.spectatorTargetId) return;

        this.pendingSpectatorTargetId = targetUserId;
        this.client.followSpectator(targetUserId).catch(error => {
            if (this.pendingSpectatorTargetId !== targetUserId) return;
            this.pendingSpectatorTargetId = null;
            this.onSpectatorError?.(error.message || 'ERRO AO TROCAR JOGADOR');
        });
    }

    createAnimations() {
        for (const characterId of CHARACTER_IDS) {
            const animationKey = `${characterId}-walk`;
            if (!this.anims.exists(animationKey)) {
                this.anims.create({
                    key: animationKey,
                    frames: this.anims.generateFrameNumbers(characterId, { start: 0, end: 2 }),
                    frameRate: 6,
                    repeat: -1
                });
            }
        }
    }

    applySnapshot(snapshot) {
        if (!snapshot?.players) return;
        this.latestSnapshot = snapshot;
        if (snapshot.viewer) {
            this.viewerStatus = snapshot.viewer.status;
            this.spectatorMode = snapshot.viewer.status !== 'playing';
            this.spectatorTargetId = snapshot.viewer.target_user_id;
            if (this.spectatorMode) this.controlsEnabled = false;
        }
        this.updateViewerHud();
        if (!this.ready) return;
        const visibleIds = new Set(snapshot.players.map(player => player.user_id));
        for (const [userId, view] of this.players) {
            if (!visibleIds.has(userId)) {
                view.sprite.destroy();
                view.label.destroy();
                this.players.delete(userId);
            }
        }
        for (const player of snapshot.players) this.updatePlayer(player);
        this.focusSpectatorTarget();
        this.updateHud(snapshot);
    }

    updatePlayer(player) {
        if (!this.ready) {
            this.pendingMovements.set(player.user_id, player);
            return;
        }
        const isLocal = player.user_id === this.profile.user_id;
        const characterId = CHARACTER_IDS.includes(player.character_id)
            ? player.character_id
            : isLocal
              ? this.profile.character_id
              : CHARACTER_IDS[0];
        const nickname = player.nickname || (isLocal ? this.profile.nickname : player.user_id);
        if (isLocal) {
            const previousFloor = this.localPlayer?.floor;
            this.localPlayer = player;
            this.viewerStatus = player.status;
            this.spectatorMode = player.status === 'eliminated' || player.status === 'finished';
            this.controlsEnabled = !this.spectatorMode;
            if (Array.isArray(player.answered_notebooks)) {
                this.answeredNotebooks = player.answered_notebooks;
            }
            if (previousFloor !== undefined && player.floor !== previousFloor) {
                this.answeredNotebooks = [];
                this.availableQuestions.clear();
                this.currentQuestion = null;
                this.closeDoor();
            }
            if (player.door_open && !this.doorIsOpen) this.openDoor();
        }
        let view = this.players.get(player.user_id);
        if (!view) {
            const sprite = this.add.sprite(
                logicalToWorld(player.x),
                logicalToWorld(player.y),
                characterId,
                0
            );
            sprite.setScale(2.5);
            sprite.setDepth(10000);
            const label = this.add
                .text(sprite.x, sprite.y - 28, nickname, {
                    backgroundColor: isLocal ? '#29452f' : '#172226',
                    color: isLocal ? '#c8f58f' : '#dce6d5',
                    fontFamily: PIXEL_FONT,
                    fontSize: '8px'
                })
                .setOrigin(0.5)
                .setPadding(4, 2, 4, 2)
                .setDepth(10001);
            view = { sprite, label, characterId, nickname };
            this.players.set(player.user_id, view);
            if (isLocal && !this.spectatorMode) {
                this.cameras.main.startFollow(sprite, true, 0.08, 0.08);
            }
        }
        if (view.characterId !== characterId) {
            view.sprite.setTexture(characterId, 0);
            view.characterId = characterId;
        }
        view.label.setText(nickname);
        view.nickname = nickname;
        view.sprite.setPosition(logicalToWorld(player.x), logicalToWorld(player.y));
        view.label.setPosition(view.sprite.x, view.sprite.y - 28);
        view.sprite.setDepth(10000);
        view.label.setDepth(10001);
        if (
            player.direction === 'west' ||
            player.direction === 'northwest' ||
            player.direction === 'southwest'
        ) {
            view.sprite.setFlipX(true);
        } else if (
            player.direction === 'east' ||
            player.direction === 'northeast' ||
            player.direction === 'southeast'
        ) {
            view.sprite.setFlipX(false);
        }
        view.sprite.setAlpha(player.status === 'eliminated' ? 0.45 : 1);
        const hiddenLocalAvatar =
            isLocal && (player.status === 'eliminated' || player.status === 'finished');
        view.sprite.setVisible(!hiddenLocalAvatar);
        view.label.setVisible(!hiddenLocalAvatar);
        const animationKey = `${view.characterId}-walk`;
        if (player.status === 'eliminated' || player.direction === 'stop') {
            view.sprite.stop();
            view.sprite.setFrame(0);
        } else if (this.anims.exists(animationKey)) view.sprite.play(animationKey, true);
        if (this.spectatorMode && player.user_id === this.spectatorTargetId) {
            this.focusSpectatorTarget();
        }
    }

    showQuestion(question) {
        if (this.spectatorMode) return;
        if (
            this.availableQuestions.size > 0 &&
            this.availableQuestions.values().next().value.floor !== question.floor
        ) {
            this.availableQuestions.clear();
        }
        this.availableQuestions.set(question.notebook_id, question);
        if (this.questionState === 'closed') this.currentQuestion = this.getNearbyQuestion();
        this.updateInteractionHint();
    }

    showAnswerResult(result) {
        if (this.spectatorMode) return;
        if (result.question_id !== this.currentQuestion?.question_id) return;
        this.answeredNotebooks = [
            ...this.answeredNotebooks.filter(
                notebook => notebook.notebook_id !== result.notebook_id
            ),
            {
                notebook_id: result.notebook_id,
                notebook_label: result.notebook_label,
                notebook_position: result.notebook_position
            }
        ];
        this.answerResult = result;
        this.questionError = null;
        if (result.correct) {
            this.currentQuestion = null;
            this.availableQuestions.clear();
            this.questionState = 'closed';
            this.clearQuestionMenu();
            this.updateInteractionHint();
            return;
        }
        this.questionState = 'feedback';
        this.renderQuestionMenu();
    }

    showDoorOpened(event) {
        if (event.floor === this.localPlayer?.floor) this.openDoor();
    }

    showQuestionError(error) {
        this.questionError = error.message || 'Não foi possível enviar a resposta.';
        this.questionState = 'error';
        this.renderQuestionMenu();
    }

    isNearCurrentNotebook() {
        return Boolean(this.getNearbyQuestion());
    }

    getNearbyQuestion() {
        if (this.localPlayer?.status === 'eliminated' || this.doorIsOpen) return null;
        return (
            [...this.availableQuestions.values()].find(
                question =>
                    !this.answeredNotebooks.some(
                        notebook => notebook.notebook_id === question.notebook_id
                    ) &&
                    isNearTile(
                        this.localPlayer,
                        question.notebook_position,
                        NOTEBOOK_INTERACTION_RANGE
                    )
            ) ?? null
        );
    }

    getNearbyAnsweredNotebook() {
        return this.answeredNotebooks.find(notebook =>
            isNearTile(this.localPlayer, notebook.notebook_position, NOTEBOOK_INTERACTION_RANGE)
        );
    }

    isNearDoor() {
        return this.doorTiles.some(tile =>
            isNearTile(
                this.localPlayer,
                { row: tile.row, column: tile.column },
                NOTEBOOK_INTERACTION_RANGE
            )
        );
    }

    updateInteractionHint() {
        if (!this.interactionHint) return;
        const visible = this.questionState === 'closed';
        let hint = '';
        if (visible && this.controlsEnabled && this.isNearCurrentNotebook()) {
            hint = 'PRESS E TO INTERACT';
        } else if (visible && this.controlsEnabled && this.getNearbyAnsweredNotebook()) {
            hint = 'YOU ALREADY ANSWERED THIS NOTEBOOK';
        } else if (visible && this.controlsEnabled && this.doorIsOpen && this.isNearDoor()) {
            hint = 'DOOR OPEN — WALK THROUGH';
        }
        if (hint !== this.interactionHintText) {
            this.interactionHintText = hint;
            this.interactionHint.setText(hint);
        }
        this.interactionHint.setVisible(visible && hint !== '');
    }

    openQuestionMenu() {
        const availableQuestion = this.getNearbyQuestion();
        if (availableQuestion) {
            this.currentQuestion = availableQuestion;
            this.questionState = 'question';
            this.selectedQuestionItem = 0;
            this.answerResult = null;
            this.questionError = null;
            this.renderQuestionMenu();
            if (this.lastDirection !== 'stop') this.sendMovement('stop');
            this.updateInteractionHint();
            return;
        }

        const answeredNotebook = this.getNearbyAnsweredNotebook();
        if (answeredNotebook) {
            this.noticeText = `YOU ALREADY ANSWERED NOTEBOOK ${answeredNotebook.notebook_label}.`;
            this.questionState = 'notice';
            this.renderQuestionMenu();
            return;
        }
    }

    closeQuestionMenu() {
        const wasFeedback = this.questionState === 'feedback' || this.questionState === 'error';
        this.questionState = 'closed';
        this.answerResult = null;
        this.questionError = null;
        this.noticeText = '';
        if (wasFeedback) {
            this.currentQuestion = null;
        }
        this.clearQuestionMenu();
        this.updateInteractionHint();
    }

    moveQuestionSelection(direction) {
        const itemCount = this.currentQuestion.options.length + 1;
        this.selectedQuestionItem = (this.selectedQuestionItem + direction + itemCount) % itemCount;
        this.renderQuestionMenu();
    }

    activateQuestionSelection() {
        if (this.questionState === 'notice') {
            this.closeQuestionMenu();
            return;
        }
        if (this.questionState === 'feedback') {
            this.closeQuestionMenu();
            return;
        }
        if (this.questionState === 'error') {
            this.questionState = 'question';
            this.questionError = null;
            this.renderQuestionMenu();
            return;
        }
        if (this.questionState !== 'question') return;
        if (this.selectedQuestionItem === this.currentQuestion.options.length) {
            this.closeQuestionMenu();
            return;
        }

        this.questionState = 'submitting';
        this.renderQuestionMenu();
        this.client
            .answer(this.currentQuestion.question_id, this.selectedQuestionItem)
            .catch(error => this.showQuestionError(error));
    }

    clearQuestionMenu() {
        for (const object of this.questionUiObjects) object.destroy();
        this.questionUiObjects = [];
    }

    createQuestionText(text, x, y, width, { color = '#dce6d5', fontSize = 7 } = {}) {
        const object = this.add
            .text(x, y, text, {
                color,
                fontFamily: PIXEL_FONT,
                fontSize: `${fontSize}px`,
                lineSpacing: Math.max(2, Math.ceil(fontSize / 2)),
                wordWrap: { width }
            })
            .setOrigin(0)
            .setScrollFactor(0)
            .setDepth(20002);
        this.questionUiObjects.push(object);
        return object;
    }

    renderQuestionMenu() {
        this.clearQuestionMenu();
        if (
            this.questionState === 'closed' ||
            (!this.currentQuestion && this.questionState !== 'notice')
        ) {
            return;
        }

        const viewportWidth = this.cameras.main.width;
        const viewportHeight = this.cameras.main.height;
        const panelWidth = viewportWidth * 0.98;
        const panelHeight = viewportHeight * 0.98;
        const panelX = (viewportWidth - panelWidth) / 2;
        const panelY = (viewportHeight - panelHeight) / 2;
        const padding = Math.min(16, Math.max(8, panelWidth * 0.03));
        const contentX = panelX + padding;
        const contentWidth = panelWidth - padding * 2;
        const fontScale = Math.min(1, Math.max(0.7, viewportWidth / 480));
        const bodyFont = Math.max(5, Math.round(8 * fontScale));
        const labelFont = Math.max(5, Math.round(6 * fontScale));
        const bodyObjects = [];
        const cards = [];
        const addBodyText = (text, x, y, width, options) => {
            const object = this.createQuestionText(text, x, y, width, options);
            bodyObjects.push(object);
            return object;
        };
        const addCard = (x, y, width, height, selected = false) => {
            cards.push({ x, y, width, height, selected });
        };

        const header = this.createQuestionText(
            this.currentQuestion
                ? `NOTEBOOK ${this.currentQuestion.notebook_label}  /  FLOOR ${this.currentQuestion.floor}`
                : 'NOTEBOOK',
            contentX,
            panelY + padding,
            contentWidth - 64,
            { color: '#c8f58f', fontSize: labelFont + 1 }
        );
        const closeLabel = this.createQuestionText(
            '[X]',
            panelX + panelWidth - padding - 36,
            panelY + padding,
            36,
            {
                color:
                    this.questionState === 'question' &&
                    this.selectedQuestionItem === this.currentQuestion.options.length
                        ? '#ffdb70'
                        : '#dce6d5',
                fontSize: labelFont
            }
        );
        const bodyStartY = panelY + padding + Math.max(header.height, closeLabel.height) + 14;
        let contentY = bodyStartY;

        if (this.questionState === 'question' || this.questionState === 'submitting') {
            const promptHeading = addBodyText('QUESTION', contentX, contentY, contentWidth, {
                color: '#8dbb69',
                fontSize: labelFont
            });
            contentY += promptHeading.height + 6;

            const prompt = addBodyText(
                this.currentQuestion.prompt,
                contentX + 10,
                contentY + 9,
                contentWidth - 20,
                { color: '#ffffff', fontSize: bodyFont }
            );
            const promptCardHeight = prompt.height + 18;
            addCard(contentX, contentY, contentWidth, promptCardHeight);
            contentY += promptCardHeight + 12;

            const answersHeading = addBodyText(
                'CHOOSE AN ANSWER',
                contentX,
                contentY,
                contentWidth,
                { color: '#8dbb69', fontSize: labelFont }
            );
            contentY += answersHeading.height + 6;

            for (const [index, option] of this.currentQuestion.options.entries()) {
                const selected =
                    this.selectedQuestionItem === index && this.questionState === 'question';
                const answer = addBodyText(option, contentX + 42, contentY + 9, contentWidth - 54, {
                    color: selected ? '#ffdb70' : '#dce6d5',
                    fontSize: bodyFont
                });
                const cardHeight = Math.max(30, answer.height + 18);
                addCard(contentX, contentY, contentWidth, cardHeight, selected);
                const marker = addBodyText(`${index + 1}.`, contentX + 10, contentY + 10, 26, {
                    color: selected ? '#ffdb70' : '#8dbb69',
                    fontSize: labelFont
                });
                contentY += Math.max(cardHeight, marker.height + 20) + 7;
            }

            if (this.questionState === 'submitting') {
                const status = addBodyText(
                    'ENVIANDO RESPOSTA...',
                    contentX,
                    contentY,
                    contentWidth,
                    { color: '#c8f58f', fontSize: labelFont }
                );
                contentY += status.height + 6;
            }
        } else if (this.questionState === 'feedback') {
            const result = this.answerResult;
            const feedback = addBodyText(
                result.correct ? 'RESPOSTA CORRETA!' : 'RESPOSTA INCORRETA',
                contentX,
                contentY,
                contentWidth,
                {
                    color: result.correct ? '#c8f58f' : '#ff9b8e',
                    fontSize: labelFont + 1
                }
            );
            contentY += feedback.height + 10;

            const correctAnswer = addBodyText(
                `CORRECT ANSWER\n${result.correct_option_index + 1}. ${this.currentQuestion.options[result.correct_option_index]}`,
                contentX + 10,
                contentY + 9,
                contentWidth - 20,
                { color: '#ffdb70', fontSize: bodyFont }
            );
            const answerCardHeight = correctAnswer.height + 18;
            addCard(contentX, contentY, contentWidth, answerCardHeight);
            contentY += answerCardHeight + 10;

            const explanationHeading = addBodyText(
                'EXPLANATION',
                contentX,
                contentY,
                contentWidth,
                { color: '#8dbb69', fontSize: labelFont }
            );
            contentY += explanationHeading.height + 6;
            const explanation = addBodyText(
                result.explanation,
                contentX + 10,
                contentY + 9,
                contentWidth - 20,
                { color: '#b9c9ad', fontSize: bodyFont }
            );
            const explanationCardHeight = explanation.height + 18;
            addCard(contentX, contentY, contentWidth, explanationCardHeight);
            contentY += explanationCardHeight + 10;
            if (result.retry_after_ms) {
                const door = addBodyText(
                    `A PORTA ABRIRÁ EM ${Math.ceil(result.retry_after_ms / 1000)} SEGUNDOS.`,
                    contentX,
                    contentY,
                    contentWidth,
                    { color: '#ffdb70', fontSize: labelFont }
                );
                contentY += door.height + 6;
            }
        } else if (this.questionState === 'error' || this.questionState === 'notice') {
            const error = addBodyText(
                this.questionState === 'notice' ? this.noticeText : this.questionError,
                contentX + 10,
                contentY + 9,
                contentWidth - 20,
                {
                    color: this.questionState === 'notice' ? '#ffdb70' : '#ff9b8e',
                    fontSize: bodyFont
                }
            );
            const errorCardHeight = error.height + 18;
            addCard(contentX, contentY, contentWidth, errorCardHeight);
            contentY += errorCardHeight + 10;
        }

        const controls = this.createQuestionText(
            this.questionState === 'feedback'
                ? 'E: CONTINUE   /   ESC: CLOSE'
                : this.questionState === 'notice'
                  ? 'E: OK   /   ESC: CLOSE'
                  : this.questionState === 'error'
                    ? 'E: TRY AGAIN   /   ESC: CLOSE'
                    : 'ARROWS: SELECT   /   E: CONFIRM   /   ESC: CLOSE',
            contentX,
            panelY + panelHeight - padding,
            contentWidth,
            { color: '#c8f58f', fontSize: labelFont }
        );
        const footerY = panelY + panelHeight - padding - controls.height;
        controls.setPosition(contentX, footerY);

        const bodyHeight = contentY - bodyStartY;
        const availableBodyHeight = Math.max(1, footerY - bodyStartY - 12);
        const textScale = Math.min(1, availableBodyHeight / bodyHeight);
        const graphics = this.add.graphics().setScrollFactor(0).setDepth(20001);
        graphics.fillStyle(0x10191c, 0.96);
        graphics.lineStyle(2, 0x8dbb69, 1);
        graphics.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 8);
        graphics.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 8);
        for (const card of cards) {
            const x = contentX + (card.x - contentX) * textScale;
            const y = bodyStartY + (card.y - bodyStartY) * textScale;
            graphics.fillStyle(card.selected ? 0x263b32 : 0x172226, 1);
            graphics.fillRoundedRect(x, y, card.width * textScale, card.height * textScale, 4);
            graphics.lineStyle(1, card.selected ? 0xc8f58f : 0x53666a, 1);
            graphics.strokeRoundedRect(x, y, card.width * textScale, card.height * textScale, 4);
        }
        this.questionUiObjects.push(graphics);

        for (const object of bodyObjects) {
            const originalX = object.x;
            const originalY = object.y;
            object.setScale(textScale);
            object.setPosition(
                contentX + (originalX - contentX) * textScale,
                bodyStartY + (originalY - bodyStartY) * textScale
            );
        }
        this.interactionHint?.setVisible(false);
    }

    updateMovement(movement) {
        this.updatePlayer(movement);
    }

    updateHud(snapshot) {
        const localPlayer = snapshot.players.find(
            player => player.user_id === this.profile.user_id
        );
        if (!localPlayer) return;
        this.onHudUpdate?.({
            floor: localPlayer.floor,
            status:
                localPlayer.status === 'finished'
                    ? 'FINISHED'
                    : localPlayer.status === 'eliminated'
                      ? 'SPECTATOR'
                      : 'PLAYING'
        });
    }

    updateViewerHud() {
        if (!this.spectatorMode) return;
        this.onHudUpdate?.({
            floor: this.localPlayer?.floor ?? 1,
            status: this.viewerStatus === 'finished' ? 'FINISHED' : 'SPECTATOR'
        });
    }

    resizeCamera(gameSize) {
        this.baseCameraZoom = Math.min(gameSize.width / WORLD_SIZE, gameSize.height / WORLD_SIZE);
        if (this.spectatorMode) this.focusSpectatorTarget();
        else {
            this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
            this.cameras.main.setZoom(this.baseCameraZoom);
        }
        this.interactionHint?.setPosition(gameSize.width / 2, gameSize.height - 18);
        if (this.questionState !== 'closed') this.renderQuestionMenu();
    }

    update(time) {
        if (this.spectatorMode) {
            const justDown = Phaser.Input.Keyboard.JustDown;
            if (this.cursors?.left && justDown(this.cursors.left)) {
                this.moveSpectatorTarget(-1);
            } else if (this.cursors?.right && justDown(this.cursors.right)) {
                this.moveSpectatorTarget(1);
            }
            return;
        }

        if (this.questionState !== 'closed') {
            const justDown = Phaser.Input.Keyboard.JustDown;
            if (
                this.questionState === 'question' &&
                ((this.cursors?.up && justDown(this.cursors.up)) ||
                    (this.cursors?.left && justDown(this.cursors.left)))
            ) {
                this.moveQuestionSelection(-1);
            }
            if (
                this.questionState === 'question' &&
                ((this.cursors?.down && justDown(this.cursors.down)) ||
                    (this.cursors?.right && justDown(this.cursors.right)))
            ) {
                this.moveQuestionSelection(1);
            }
            if (this.cancelKey && justDown(this.cancelKey)) {
                if (this.questionState !== 'submitting') this.closeQuestionMenu();
            } else if (this.interactKey && justDown(this.interactKey)) {
                this.activateQuestionSelection();
            }
            return;
        }

        this.updateInteractionHint();
        if (!this.controlsEnabled || !this.client) return;
        if (this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
            if (this.getNearbyAnsweredNotebook()) {
                this.openQuestionMenu();
                return;
            }
            if (!this.isNearCurrentNotebook()) return;
            this.openQuestionMenu();
            return;
        }
        if (time - this.lastMoveAt < MOVE_INTERVAL_MS) return;
        const direction = getDirection(this.cursors, this.keys);
        if (direction === this.lastDirection && direction === 'stop') return;
        this.sendMovement(direction, time);
    }

    sendMovement(direction, time = this.lastMoveAt) {
        this.lastDirection = direction;
        this.lastMoveAt = time;
        this.sequence += 1;
        try {
            this.client.move(this.sequence, direction);
        } catch {
            this.controlsEnabled = false;
        }
    }

    destroyScene() {
        this.scale.off('resize', this.resizeCamera, this);
        this.clearQuestionMenu();
        this.scene.stop('top-down-scene');
    }
}

export function createTopDownGame({
    root,
    client,
    profile,
    snapshot,
    room,
    question,
    questions,
    answerResult,
    rankingEntries,
    onHudUpdate,
    onSpectatorError
}) {
    const scene = new TopDownScene(onHudUpdate, onSpectatorError);
    root.replaceChildren();
    const game = new Phaser.Game({
        type: Phaser.CANVAS,
        parent: root,
        width: GAME_VIEW_SIZE,
        height: GAME_VIEW_SIZE,
        pixelArt: true,
        backgroundColor: '#172226',
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH
        },
        input: {
            keyboard: true
        },
        scene
    });
    game.scene.start('top-down-scene', {
        client,
        profile,
        snapshot,
        room,
        question,
        questions,
        answerResult,
        rankingEntries
    });
    return {
        game,
        applySnapshot: snapshotValue => scene.applySnapshot(snapshotValue),
        updateMovement: movement => scene.updatePlayer(movement),
        updateRanking: entries => scene.updateRanking(entries),
        showQuestion: questionValue => scene.showQuestion(questionValue),
        showAnswerResult: result => scene.showAnswerResult(result),
        setSpectatorMode: options => scene.setSpectatorMode(options),
        setSpectatorTarget: targetUserId => scene.setSpectatorTarget(targetUserId),
        destroy() {
            scene.destroyScene();
            game.destroy(true);
        }
    };
}
