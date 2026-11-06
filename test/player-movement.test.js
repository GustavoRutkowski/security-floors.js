import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAP_BOUNDS, isMovementDirection, movePosition } from '../ws/player-movement.js';

describe('authoritative player movement', () => {
    it('moves one logical unit in each cardinal direction', () => {
        assert.deepEqual(movePosition({ x: 50, y: 50 }, 'north'), { x: 50, y: 49 });
        assert.deepEqual(movePosition({ x: 50, y: 50 }, 'east'), { x: 51, y: 50 });
        assert.deepEqual(movePosition({ x: 50, y: 50 }, 'south'), { x: 50, y: 51 });
        assert.deepEqual(movePosition({ x: 50, y: 50 }, 'west'), { x: 49, y: 50 });
        assert.deepEqual(movePosition({ x: 50, y: 50 }, 'stop'), { x: 50, y: 50 });
    });

    it('normalizes diagonal movement and clamps to map bounds', () => {
        const diagonal = movePosition({ x: 50, y: 50 }, 'southeast');
        assert.ok(Math.abs(Math.hypot(diagonal.x - 50, diagonal.y - 50) - 1) < 1e-12);
        assert.deepEqual(movePosition({ x: 0, y: 0 }, 'northwest'), { x: 0, y: 0 });
        assert.deepEqual(movePosition({ x: MAP_BOUNDS.maxX, y: MAP_BOUNDS.maxY }, 'southeast'), {
            x: MAP_BOUNDS.maxX,
            y: MAP_BOUNDS.maxY
        });
    });

    it('accepts only the eight directions and stop', () => {
        for (const direction of [
            'north',
            'northeast',
            'east',
            'southeast',
            'south',
            'southwest',
            'west',
            'northwest',
            'stop'
        ]) {
            assert.equal(isMovementDirection(direction), true);
        }
        assert.equal(isMovementDirection('up'), false);
        assert.throws(() => movePosition({ x: 0, y: 0 }, 'up'), /must be valid/);
    });
});
