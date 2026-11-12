import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { URL } from 'node:url';
import {
    getDoorTiles,
    getNotebookTiles,
    getTileAt,
    isBlockedAt,
    isDoorTileAt,
    isNearTile,
    LOGICAL_TILE_SIZE,
    MAPS,
    MAP_SIZE,
    TILE_TYPES
} from '../map-layout.js';
import { movePosition } from '../ws/player-movement.js';

describe('map layout', () => {
    it('uses 15 columns and 15 rows for every notebook configuration', () => {
        assert.equal(MAP_SIZE, 15);
        for (const map of Object.values(MAPS)) {
            assert.equal(map.length, MAP_SIZE);
            for (const row of map) assert.equal(row.length, MAP_SIZE);
        }
    });

    it('matches the maps documented in TILESET.md', () => {
        const document = readFileSync(new URL('../docs/TILESET.md', import.meta.url), 'utf8');
        const sections = Array.from(document.matchAll(/^### (.+)\n\n```text\n([\s\S]*?)\n```/gm));
        const documentedMaps = [
            ['Um caderno', MAPS[1]],
            ['Dois cadernos', MAPS[2]],
            ['Três cadernos', MAPS[3]],
            ['Quatro cadernos', MAPS[4]]
        ];

        for (const [title, map] of documentedMaps) {
            const section = sections.find(([, heading]) => heading === title);
            assert.ok(section, `Missing map section: ${title}`);
            assert.deepEqual(section[2].split('\n'), map, `Map mismatch: ${title}`);
        }
    });

    it('blocks only the upper half of every collidable tile', () => {
        for (const [notebooksPerFloor, map] of Object.entries(MAPS)) {
            for (let row = 0; row < MAP_SIZE; row += 1) {
                for (let column = 0; column < MAP_SIZE; column += 1) {
                    if (!TILE_TYPES[map[row][column]]?.blocksMovement) continue;

                    const positionAt = verticalOffset => ({
                        x: (column + 0.5) * LOGICAL_TILE_SIZE,
                        y: (row + verticalOffset) * LOGICAL_TILE_SIZE
                    });
                    assert.equal(isBlockedAt(positionAt(0.25), Number(notebooksPerFloor)), true);
                    assert.equal(isBlockedAt(positionAt(0.75), Number(notebooksPerFloor)), false);
                }
            }
        }
    });

    it('locates notebook tiles and checks proximity to their boundaries', () => {
        const notebooks = getNotebookTiles(2);
        assert.equal(notebooks.length, 2);
        assert.equal(isNearTile({ x: 2, y: 56 }, notebooks[0], 5), true);
        assert.equal(isNearTile({ x: 2, y: 56 }, notebooks[0], 4), false);
        assert.equal(isNearTile({ x: 2, y: 56 }, notebooks[1], 5), false);
    });

    it('identifies door tiles and allows collision-free entry only while open', () => {
        const doorTiles = getDoorTiles(1);
        assert.equal(doorTiles.length, 6);
        assert.deepEqual(doorTiles.slice(3), [
            { row: 1, column: 6 },
            { row: 1, column: 7 },
            { row: 1, column: 8 }
        ]);
        assert.equal(isDoorTileAt({ x: 50, y: 10 }, 1), true);
        assert.equal(isDoorTileAt({ x: 50, y: 20 }, 1), false);

        const start = { x: 50, y: 15 };
        const closedDoorPosition = movePosition(start, 'north');
        assert.ok(closedDoorPosition.y < start.y);
        assert.equal(isDoorTileAt(closedDoorPosition, 1), false);
        assert.deepEqual(movePosition(start, 'north', { doorOpen: true }), { x: 50, y: 12.5 });
    });

    it('applies collision behavior based on each tile type', () => {
        const tileCenter = (row, column) => ({
            x: (column + 0.5) * LOGICAL_TILE_SIZE,
            y: (row + 0.5) * LOGICAL_TILE_SIZE
        });

        assert.equal(isBlockedAt(tileCenter(2, 0)), false);
        assert.equal(isBlockedAt(tileCenter(4, 3)), false);
        assert.equal(isBlockedAt({ x: tileCenter(0, 0).x, y: LOGICAL_TILE_SIZE * 0.25 }), true);
        assert.equal(isBlockedAt({ x: tileCenter(0, 6).x, y: LOGICAL_TILE_SIZE * 0.25 }), true);
        assert.equal(
            isBlockedAt({
                x: tileCenter(8, 7).x,
                y: (8 + 0.25) * LOGICAL_TILE_SIZE
            }),
            true
        );
        assert.equal(isBlockedAt(tileCenter(8, 7)), false);
    });

    it('interprets each map code as its tile type and movement behavior', () => {
        assert.deepEqual(getTileAt(1, 0, 0), { type: TILE_TYPES[1], row: 0, column: 0 });
        assert.deepEqual(getTileAt(1, 0, 6), { type: TILE_TYPES[2], row: 0, column: 6 });
        assert.equal(getTileAt(1, 2, 0).type, TILE_TYPES[0]);
        assert.equal(getTileAt(1, 4, 3).type, TILE_TYPES[3]);
        assert.equal(getTileAt(1, 8, 7).type, TILE_TYPES[4]);
        assert.equal(getTileAt(1, -1, 0), null);
        assert.equal(TILE_TYPES[0].blocksMovement, false);
        assert.equal(TILE_TYPES[1].blocksMovement, true);
        assert.equal(TILE_TYPES[2].blocksMovement, true);
        assert.equal(TILE_TYPES[3].blocksMovement, false);
        assert.equal(TILE_TYPES[4].blocksMovement, true);
    });
});
