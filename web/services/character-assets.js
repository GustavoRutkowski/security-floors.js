import { CHARACTERS } from './character-catalog.js';

const SPRITE_DIRECTORY = '/spritesheets/characters/';
const spriteAssets = import.meta.glob('/spritesheets/characters/*.png', {
    eager: true,
    import: 'default',
    query: '?url'
});
const spriteUrls = new Map(
    Object.entries(spriteAssets).map(([path, url]) => [path.slice(SPRITE_DIRECTORY.length), url])
);
const catalogSprites = new Set(CHARACTERS.map(character => character.sprite));
const missingSprites = [...catalogSprites].filter(sprite => !spriteUrls.has(sprite));
const unregisteredSprites = [...spriteUrls.keys()].filter(sprite => !catalogSprites.has(sprite));

if (missingSprites.length > 0 || unregisteredSprites.length > 0) {
    throw new Error(
        [
            missingSprites.length > 0
                ? `Missing character sprites: ${missingSprites.join(', ')}`
                : '',
            unregisteredSprites.length > 0
                ? `Unregistered character sprites: ${unregisteredSprites.join(', ')}`
                : ''
        ]
            .filter(Boolean)
            .join('. ')
    );
}

export function getCharacterSpriteUrl(character) {
    const url = spriteUrls.get(character?.sprite);
    if (!url) throw new RangeError(`Unknown character sprite: ${character?.sprite}`);
    return url;
}
