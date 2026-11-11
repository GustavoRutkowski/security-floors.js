import characterCatalog from '../characters.json' with { type: 'json' };

export const DEFAULT_CHARACTER_ID = 'bobabao';

function validateCatalog(catalog) {
    if (!Array.isArray(catalog) || catalog.length === 0) {
        throw new TypeError('Character catalog must be a non-empty array.');
    }

    const ids = new Set();
    const sprites = new Set();
    const characters = catalog.map(character => {
        if (
            !character ||
            typeof character.id !== 'string' ||
            !/^[a-z0-9._-]+$/i.test(character.id) ||
            typeof character.name !== 'string' ||
            character.name.trim() === '' ||
            typeof character.sprite !== 'string' ||
            !/^[a-z0-9._-]+\.png$/i.test(character.sprite) ||
            ids.has(character.id) ||
            sprites.has(character.sprite)
        ) {
            throw new TypeError(
                'Character catalog entries must have unique valid IDs and PNG files.'
            );
        }

        ids.add(character.id);
        sprites.add(character.sprite);
        return Object.freeze({
            id: character.id,
            name: character.name.trim(),
            sprite: character.sprite
        });
    });

    if (!ids.has(DEFAULT_CHARACTER_ID)) {
        throw new TypeError(
            `Character catalog must include the default character: ${DEFAULT_CHARACTER_ID}.`
        );
    }

    return Object.freeze(characters);
}

export const CHARACTERS = validateCatalog(characterCatalog);

export function getCharacter(characterId) {
    return CHARACTERS.find(character => character.id === characterId) ?? null;
}
