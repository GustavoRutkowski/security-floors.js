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
        const blockedByTable = movePosition({ x: 4.5, y: 56 }, 'east', { notebooksPerFloor: 2 });
        assert.equal(blockedByTable.x, 4.5);
        assert.equal(blockedByTable.y, 56);
    });

    it('advances to the last safe position when approaching a table', () => {
        const start = { x: 20, y: (8.5 * 100) / 15 };
        const next = movePosition(start, 'west', { notebooksPerFloor: 2 });
        assert.ok(next.x < start.x);
        assert.ok(next.x > 13.33);
        assert.equal(next.y, start.y);
        assert.deepEqual(movePosition(next, 'west', { notebooksPerFloor: 2 }), next);
    });

    it('allows movement through spawnpoint tiles', () => {
        assert.deepEqual(movePosition({ x: 10, y: 20 }, 'east', { notebooksPerFloor: 2 }), {
            x: 12.5,
            y: 20
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
