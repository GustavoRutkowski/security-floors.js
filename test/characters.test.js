import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

    it('uses three 16x16 animation frames in every character spritesheet', () => {
        for (const character of CHARACTERS) {
            const image = readFileSync(
                new URL(`../web/spritesheets/characters/${character.sprite}`, import.meta.url)
            );
            assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a');
            assert.equal(image.readUInt32BE(16), 16, `${character.sprite} width`);
            assert.equal(image.readUInt32BE(20), 48, `${character.sprite} height`);
        }
    });
});
