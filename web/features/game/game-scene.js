import Phaser from 'phaser';
import { CHARACTERS } from '../../services/character-catalog.js';
import { getCharacterSpriteUrl } from '../../services/character-assets.js';

const WORLD_SIZE = 800;
const LOGICAL_MAP_SIZE = 100;
const MOVE_INTERVAL_MS = 85;
const CHARACTER_IDS = CHARACTERS.map(character => character.id);
const TILE_SIZE = 32;
const MAP_SIZE = 25;
const TILESET_KEY = 'tileset';
const TILESET_URL = '/spritesheets/TILESET.png';
const MAPS = {
    1: [
        '1111111111122211111111111',
        '1111111111122211111111111',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000033333333300000000',
        '0000000033333333300000000',
        '0000000033000003300000000',
        '0000000033000003300000000',
        '0000000033004003300000000',
        '0000000033000003300000000',
        '0000000033000003300000000',
        '0000000033333333300000000',
        '0000000033333333300000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000'
    ],
    2: [
        '1111111111122211111111111',
        '1111111111122211111111111',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000040000333330000400000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000'
    ],
    3: [
        '1111111111122211111111111',
        '1111111111122211111111111',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000004000000000004000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000004000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000'
    ],
    4: [
        '1111111111122211111111111',
        '1111111111122211111111111',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000400000000040000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000000000333330000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000400000000040000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000',
        '0000000000000000000000000'
    ]
};

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
    constructor(onHudUpdate) {
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
        this.notebooksPerFloor = 1;
    }

    init(data) {
        this.client = data.client;
        this.profile = data.profile;
        this.latestSnapshot = data.snapshot;
        this.notebooksPerFloor = data.room?.notebooks_per_floor ?? 1;
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
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.keys = this.input.keyboard.addKeys('W,A,S,D');
        } else {
            this.controlsEnabled = false;
        }
        this.ready = true;
        this.applySnapshot(this.latestSnapshot);
        for (const movement of this.pendingMovements.values()) this.updatePlayer(movement);
        this.pendingMovements.clear();
        this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
        this.cameras.main.setZoom(
            Math.min(this.scale.width / WORLD_SIZE, this.scale.height / WORLD_SIZE)
        );
        this.scale.on('resize', this.resizeCamera, this);
    }

    createMap() {
        const map = MAPS[this.notebooksPerFloor] || MAPS[1];
        for (let row = 0; row < MAP_SIZE; row += 1) {
            for (let column = 0; column < MAP_SIZE; column += 1) {
                const code = map[row][column];
                this.addTile(column, row, 0);
                if (code === '1') this.addTile(column, row, 1);
                if (code === '4') this.addTile(column, row, 2);
            }
        }

        const doorColumn = map[0].indexOf('2');
        if (doorColumn >= 0) {
            for (let row = 0; row < 2; row += 1) {
                for (let column = 0; column < 3; column += 1) {
                    this.addTile(doorColumn + column, row, 3 + row * 3 + column, 2);
                }
            }
        }
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
                    fontFamily: 'Press Start 2P',
                    fontSize: '8px'
                })
                .setOrigin(0.5)
                .setPadding(4, 2, 4, 2)
                .setDepth(10001);
            view = { sprite, label, characterId };
            this.players.set(player.user_id, view);
            if (isLocal) this.cameras.main.startFollow(sprite, true, 0.08, 0.08);
        }
        if (view.characterId !== characterId) {
            view.sprite.setTexture(characterId, 0);
            view.characterId = characterId;
        }
        view.label.setText(nickname);
        view.sprite.setPosition(logicalToWorld(player.x), logicalToWorld(player.y));
        view.label.setPosition(view.sprite.x, view.sprite.y - 28);
        view.sprite.setDepth(10000);
        view.label.setDepth(10001);
        view.sprite.setFlipX(
            player.direction === 'west' ||
                player.direction === 'northwest' ||
                player.direction === 'southwest'
        );
        view.sprite.setAlpha(player.status === 'eliminated' ? 0.45 : 1);
        const animationKey = `${view.characterId}-walk`;
        if (player.status === 'eliminated' || player.direction === 'stop') {
            view.sprite.stop();
            view.sprite.setFrame(0);
        } else if (this.anims.exists(animationKey)) view.sprite.play(animationKey, true);
        if (isLocal) this.controlsEnabled = player.status !== 'eliminated';
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
            status: localPlayer.status === 'eliminated' ? 'SPECTATOR' : 'PLAYING'
        });
    }

    resizeCamera(gameSize) {
        this.cameras.main.setZoom(
            Math.min(gameSize.width / WORLD_SIZE, gameSize.height / WORLD_SIZE)
        );
    }

    update(time) {
        if (!this.controlsEnabled || !this.client || time - this.lastMoveAt < MOVE_INTERVAL_MS)
            return;
        const direction = getDirection(this.cursors, this.keys);
        if (direction === this.lastDirection && direction === 'stop') return;
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
        this.scene.stop('top-down-scene');
    }
}

export function createTopDownGame({ root, client, profile, snapshot, room, onHudUpdate }) {
    const scene = new TopDownScene(onHudUpdate);
    root.replaceChildren();
    const game = new Phaser.Game({
        type: Phaser.CANVAS,
        parent: root,
        width: root.clientWidth || 800,
        height: root.clientHeight || 520,
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
    game.scene.start('top-down-scene', { client, profile, snapshot, room });
    return {
        game,
        applySnapshot: snapshotValue => scene.applySnapshot(snapshotValue),
        updateMovement: movement => scene.updatePlayer(movement),
        destroy() {
            scene.destroyScene();
            game.destroy(true);
        }
    };
}
