import '@fontsource/press-start-2p';
import Phaser from 'phaser';
import './style.css';

const bootStartedAt = performance.now();
const minimumLoadingTime = 420;

function showReadyState() {
    const remaining = Math.max(0, minimumLoadingTime - (performance.now() - bootStartedAt));

    window.setTimeout(() => {
        document.getElementById('loading-layer').hidden = true;
        document.getElementById('boot-status').textContent = 'CLIENTE PRONTO';
        document.getElementById('renderer-status').textContent = 'PHASER OK';
        document.documentElement.dataset.state = 'ready';
    }, remaining);
}

class EntryScene extends Phaser.Scene {
    constructor() {
        super('EntryScene');
    }

    create() {
        try {
            this.drawFloor();
            this.scale.on('resize', this.drawFloor, this);
            showReadyState();
        } catch (error) {
            window.showBootError(error);
        }
    }

    drawFloor() {
        this.children.removeAll(true);

        const width = this.scale.width;
        const height = this.scale.height;
        const tileSize = 32;
        const graphics = this.add.graphics();

        this.cameras.main.setBackgroundColor('#172226');

        for (let row = 0; row < Math.ceil(height / tileSize); row += 1) {
            for (let column = 0; column < Math.ceil(width / tileSize); column += 1) {
                const shade = (row + column) % 2 === 0 ? 0x1b292d : 0x1e2d31;
                graphics.fillStyle(shade, 1);
                graphics.fillRect(column * tileSize, row * tileSize, tileSize, tileSize);
            }
        }

        graphics.lineStyle(1, 0x344448, 0.6);
        for (let x = 0; x <= width; x += tileSize) {
            graphics.lineBetween(x, 0, x, height);
        }
        for (let y = 0; y <= height; y += tileSize) {
            graphics.lineBetween(0, y, width, y);
        }

        graphics.fillStyle(0x10191c, 1);
        graphics.fillRect(0, 0, width, 18);
        graphics.fillRect(0, height - 18, width, 18);
        graphics.fillRect(0, 0, 18, height);
        graphics.fillRect(width - 18, 0, 18, height);

        const centerX = Math.floor(width / 2);
        const centerY = Math.floor(height / 2);
        graphics.fillStyle(0x293a3e, 1);
        graphics.fillRect(centerX - 70, centerY - 54, 140, 108);
        graphics.fillStyle(0x10191c, 1);
        graphics.fillRect(centerX - 54, centerY - 38, 108, 76);

        graphics.fillStyle(0xf18467, 1);
        graphics.fillRect(centerX - 9, centerY - 22, 18, 18);
        graphics.fillStyle(0xa8d86e, 1);
        graphics.fillRect(centerX - 12, centerY - 3, 24, 25);
        graphics.fillStyle(0x10191c, 1);
        graphics.fillRect(centerX - 9, centerY + 19, 6, 9);
        graphics.fillRect(centerX + 3, centerY + 19, 6, 9);

        graphics.fillStyle(0x78bfc0, 1);
        graphics.fillRect(centerX - 38, height - 18, 76, 8);
        graphics.fillStyle(0xf0ad5e, 1);
        graphics.fillRect(width - 34, centerY - 6, 8, 12);

        this.add
            .text(centerX, centerY - 78, 'ENTRY HALL / 00', {
                color: '#dce6d5',
                fontFamily: 'Press Start 2P',
                fontSize: '10px'
            })
            .setOrigin(0.5);

        this.add
            .text(width - 44, centerY + 22, 'LIFT', {
                color: '#f0ad5e',
                fontFamily: 'Press Start 2P',
                fontSize: '8px'
            })
            .setOrigin(1, 0);
    }
}

try {
    new Phaser.Game({
        type: Phaser.AUTO,
        parent: 'game-root',
        backgroundColor: '#172226',
        pixelArt: true,
        scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH,
            width: 960,
            height: 540
        },
        render: {
            antialias: false,
            pixelArt: true,
            roundPixels: true
        },
        scene: [EntryScene]
    });
} catch (error) {
    window.showBootError(error);
}
