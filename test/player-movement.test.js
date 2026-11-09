import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAP_BOUNDS, isMovementDirection, movePosition } from '../ws/player-movement.js';

describe('authoritative player movement', () => {
    it('moves 2.5 logical units in each cardinal direction', () => {
        assert.deepEqual(movePosition({ x: 50, y: 80 }, 'north'), { x: 50, y: 77.5 });
        assert.deepEqual(movePosition({ x: 50, y: 80 }, 'east'), { x: 52.5, y: 80 });
        assert.deepEqual(movePosition({ x: 50, y: 80 }, 'south'), { x: 50, y: 82.5 });
        assert.deepEqual(movePosition({ x: 50, y: 80 }, 'west'), { x: 47.5, y: 80 });
        assert.deepEqual(movePosition({ x: 50, y: 80 }, 'stop'), { x: 50, y: 80 });
    });

    it('normalizes diagonal movement and clamps to map bounds', () => {
        const diagonal = movePosition({ x: 50, y: 80 }, 'southeast');
        assert.ok(Math.abs(Math.hypot(diagonal.x - 50, diagonal.y - 80) - 2.5) < 1e-12);
        assert.deepEqual(movePosition({ x: 0, y: 0 }, 'northwest'), { x: 0, y: 0 });
        assert.deepEqual(movePosition({ x: MAP_BOUNDS.maxX, y: MAP_BOUNDS.maxY }, 'southeast'), {
            x: MAP_BOUNDS.maxX,
            y: MAP_BOUNDS.maxY
        });
    });

    it('stops at walls and notebooks instead of crossing their tiles', () => {
        assert.deepEqual(movePosition({ x: 50, y: 10 }, 'north'), { x: 50, y: 10 });
        assert.deepEqual(movePosition({ x: 18, y: 54 }, 'east', { notebooksPerFloor: 2 }), {
            x: 18,
            y: 54
        });
    });

    it('allows movement through spawnpoint tiles', () => {
        assert.deepEqual(movePosition({ x: 26, y: 34 }, 'east', { notebooksPerFloor: 2 }), {
            x: 28.5,
            y: 34
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
