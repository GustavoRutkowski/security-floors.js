import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { URL } from 'node:url';
import {
    getTileAt,
    isBlockedAt,
    LOGICAL_TILE_SIZE,
    MAPS,
    MAP_SIZE,
    TILE_TYPES
} from '../map-layout.js';

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

    it('blocks table collisions on their exact tile coordinates', () => {
        for (const [notebooksPerFloor, map] of Object.entries(MAPS)) {
            for (let row = 0; row < MAP_SIZE; row += 1) {
                for (let column = 0; column < MAP_SIZE; column += 1) {
                    if (map[row][column] !== '4') continue;

                    const position = {
                        x: (column + 0.5) * LOGICAL_TILE_SIZE,
                        y: (row + 0.5) * LOGICAL_TILE_SIZE
                    };
                    assert.equal(isBlockedAt(position, Number(notebooksPerFloor)), true);
                }
            }
        }
    });

    it('applies collision behavior based on each tile type', () => {
        const tileCenter = (row, column) => ({
            x: (column + 0.5) * LOGICAL_TILE_SIZE,
            y: (row + 0.5) * LOGICAL_TILE_SIZE
        });

        assert.equal(isBlockedAt(tileCenter(2, 0)), false);
        assert.equal(isBlockedAt(tileCenter(4, 3)), false);
        assert.equal(isBlockedAt(tileCenter(0, 0)), true);
        assert.equal(isBlockedAt(tileCenter(0, 6)), true);
        assert.equal(isBlockedAt(tileCenter(8, 7)), true);
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
