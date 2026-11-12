import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { URL } from 'node:url';
import {
    TILESET_COLUMNS,
    TILESET_FRAME,
    TILESET_ROWS,
    TILESET_TILE_SIZE,
    getNotebookFrame
} from '../web/features/game/tileset-layout.js';

describe('tileset layout', () => {
    it('matches the 48x128 sprite sheet and its two-row door states', () => {
        const tileset = readFileSync(new URL('../web/spritesheets/TILESET.png', import.meta.url));

        assert.equal(tileset.readUInt32BE(16), TILESET_COLUMNS * TILESET_TILE_SIZE);
        assert.equal(tileset.readUInt32BE(20), TILESET_ROWS * TILESET_TILE_SIZE);
        assert.deepEqual(
            [TILESET_FRAME.doorLocked, TILESET_FRAME.doorMid, TILESET_FRAME.doorOpen],
            [6, 12, 18]
        );

        for (const firstFrame of [
            TILESET_FRAME.doorLocked,
            TILESET_FRAME.doorMid,
            TILESET_FRAME.doorOpen
        ]) {
            assert.equal(firstFrame % TILESET_COLUMNS, 0);
            assert.ok(firstFrame + 5 < TILESET_COLUMNS * TILESET_ROWS);
        }

        assert.equal(TILESET_FRAME.floor, 0);
        assert.equal(TILESET_FRAME.wall, 1);
        assert.equal(TILESET_FRAME.table, 3);
        assert.equal(TILESET_FRAME.emptyTable, 4);
        assert.equal(getNotebookFrame({ answered: false, clearAll: false }), TILESET_FRAME.table);
        assert.equal(
            getNotebookFrame({ answered: true, clearAll: false }),
            TILESET_FRAME.emptyTable
        );
        assert.equal(
            getNotebookFrame({ answered: false, clearAll: true }),
            TILESET_FRAME.emptyTable
        );
    });
});
