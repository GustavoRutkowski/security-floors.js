import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { URL } from 'node:url';
import { CHARACTERS, DEFAULT_CHARACTER_ID } from '../web/services/character-catalog.js';

const spritesDirectory = new URL('../web/spritesheets/characters/', import.meta.url);

describe('character catalog', () => {
    it('matches every character PNG in the spritesheet directory exactly', () => {
        const catalogSprites = CHARACTERS.map(character => character.sprite).sort();
        const directorySprites = readdirSync(spritesDirectory)
            .filter(filename => filename.endsWith('.png'))
            .sort();

        assert.deepEqual(catalogSprites, directorySprites);
    });

    it('uses Bobabao as the default selectable character', () => {
        assert.equal(DEFAULT_CHARACTER_ID, 'bobabao');
        assert.equal(
            CHARACTERS.find(character => character.id === DEFAULT_CHARACTER_ID).name,
            'BOBABAO'
        );
    });
});
