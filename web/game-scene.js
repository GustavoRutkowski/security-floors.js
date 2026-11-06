import Phaser from 'phaser';

const WORLD_SIZE = 800;
const LOGICAL_MAP_SIZE = 100;
const MOVE_INTERVAL_MS = 110;
const CHARACTER_IDS = ['bobabao', 'lixaredo', 'tubarina'];

function logicalToWorld(value) {
    return (value / LOGICAL_MAP_SIZE) * WORLD_SIZE;
}

function getDirection(cursors, keys) {
    const horizontal =
        (cursors.left.isDown || keys.a.isDown ? -1 : 0) +
        (cursors.right.isDown || keys.d.isDown ? 1 : 0);
    const vertical =
        (cursors.up.isDown || keys.w.isDown ? -1 : 0) +
        (cursors.down.isDown || keys.s.isDown ? 1 : 0);
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
    constructor() {
        super('top-down-scene');
        this.players = new Map();
        this.latestSnapshot = null;
        this.client = null;
        this.profile = null;
        this.sequence = 0;
        this.lastDirection = 'stop';
        this.lastMoveAt = 0;
        this.controlsEnabled = true;
    }

    init(data) {
        this.client = data.client;
        this.profile = data.profile;
        this.latestSnapshot = data.snapshot;
    }

    preload() {
        for (const characterId of CHARACTER_IDS) {
            this.load.spritesheet(characterId, `/spritesheets/${characterId}.png`, {
                frameWidth: 16,
                frameHeight: 16
            });
        }
    }

    create() {
        this.createMap();
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys('W,A,S,D');
        this.createAnimations();
        this.applySnapshot(this.latestSnapshot);
        this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
        this.cameras.main.setZoom(
            Math.min(this.scale.width / WORLD_SIZE, this.scale.height / WORLD_SIZE)
        );
        this.scale.on('resize', this.resizeCamera, this);
    }

    createMap() {
        const background = this.add.graphics();
        background.fillStyle(0x172226, 1);
        background.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);
        background.lineStyle(1, 0x2d4142, 0.7);
        for (let position = 0; position <= WORLD_SIZE; position += 40) {
            background.lineBetween(position, 0, position, WORLD_SIZE);
            background.lineBetween(0, position, WORLD_SIZE, position);
        }
        background.lineStyle(4, 0x78bfc0, 0.85);
        background.strokeRect(2, 2, WORLD_SIZE - 4, WORLD_SIZE - 4);
        const center = this.add.rectangle(WORLD_SIZE / 2, WORLD_SIZE / 2, 150, 150, 0x202e32, 0.75);
        center.setStrokeStyle(2, 0x405155, 1);
        this.add.text(18, 14, 'FLOOR / LIVE MAP', {
            color: '#91a29c',
            fontFamily: 'Press Start 2P',
            fontSize: '10px'
        });
    }

    createAnimations() {
        for (const characterId of CHARACTER_IDS) {
            this.anims.create({
                key: `${characterId}-walk`,
                frames: this.anims.generateFrameNumbers(characterId, { start: 0, end: 2 }),
                frameRate: 6,
                repeat: -1
            });
        }
    }

    applySnapshot(snapshot) {
        if (!snapshot?.players) return;
        this.latestSnapshot = snapshot;
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
        const isLocal = player.user_id === this.profile.user_id;
        const characterId = isLocal
            ? this.profile.character_id
            : CHARACTER_IDS[player.user_id.charCodeAt(0) % CHARACTER_IDS.length];
        let view = this.players.get(player.user_id);
        if (!view) {
            const sprite = this.add.sprite(
                logicalToWorld(player.x),
                logicalToWorld(player.y),
                characterId,
                0
            );
            sprite.setScale(2.5);
            sprite.setDepth(isLocal ? 3 : 2);
            const label = this.add
                .text(
                    sprite.x,
                    sprite.y - 28,
                    isLocal ? this.profile.nickname : player.user_id.slice(0, 4),
                    {
                        color: isLocal ? '#a8d86e' : '#dce6d5',
                        fontFamily: 'Press Start 2P',
                        fontSize: '8px'
                    }
                )
                .setOrigin(0.5);
            view = { sprite, label, characterId };
            this.players.set(player.user_id, view);
            if (isLocal) this.cameras.main.startFollow(sprite, true, 0.08, 0.08);
        }
        view.sprite.setPosition(logicalToWorld(player.x), logicalToWorld(player.y));
        view.label.setPosition(view.sprite.x, view.sprite.y - 28);
        view.sprite.setAlpha(player.status === 'eliminated' ? 0.45 : 1);
        if (player.status === 'eliminated') view.sprite.stop();
        else view.sprite.play(`${view.characterId}-walk`, true);
        if (isLocal) this.controlsEnabled = player.status !== 'eliminated';
    }

    updateHud(snapshot) {
        const localPlayer = snapshot.players.find(
            player => player.user_id === this.profile.user_id
        );
        if (!localPlayer) return;
        this.events.emit('hud-update', {
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

export function createTopDownGame({ root, client, profile, snapshot, onHudUpdate }) {
    const scene = new TopDownScene();
    scene.events.on('hud-update', onHudUpdate);
    const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: root,
        width: root.clientWidth || 800,
        height: root.clientHeight || 520,
        pixelArt: true,
        backgroundColor: '#172226',
        scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH
        },
        scene
    });
    game.scene.start('top-down-scene', { client, profile, snapshot });
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
