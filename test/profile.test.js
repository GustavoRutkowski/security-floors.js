import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    CHARACTERS,
    PROFILE_STORAGE_KEY,
    createUserId,
    loadProfile,
    saveProfile
} from '../web/services/profile-storage.js';

function createStorage(initialValues = {}) {
    const values = new Map(Object.entries(initialValues));
    return {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, value);
        },
        removeItem(key) {
            values.delete(key);
        }
    };
}

describe('local player profile', () => {
    it('generates a UUID v4 using the browser crypto API', () => {
        assert.equal(
            createUserId({ randomUUID: () => 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }),
            'f47ac10b-58cc-4372-a567-0e02b2c3d479'
        );
    });

    it('persists only the session identity and reuses its UUID when edited', () => {
        const storage = createStorage();
        const firstProfile = saveProfile(
            { nickname: '  Ana  ', character_id: CHARACTERS[0].id },
            storage
        );

        assert.match(firstProfile.user_id, /^[0-9a-f-]{36}$/i);
        assert.deepEqual(firstProfile, {
            user_id: firstProfile.user_id,
            nickname: 'Ana',
            character_id: 'bobabao'
        });
        assert.deepEqual(loadProfile(storage), firstProfile);

        const updatedProfile = saveProfile(
            {
                nickname: 'Ana L.',
                character_id: CHARACTERS.find(character => character.id === 'tubarina').id
            },
            storage
        );
        assert.equal(updatedProfile.user_id, firstProfile.user_id);
        assert.deepEqual(updatedProfile, {
            user_id: firstProfile.user_id,
            nickname: 'Ana L.',
            character_id: 'tubarina'
        });
        assert.equal(storage.getItem(PROFILE_STORAGE_KEY), JSON.stringify(updatedProfile));
    });

    it('discards malformed stored profiles and rejects invalid input', () => {
        const storage = createStorage({
            [PROFILE_STORAGE_KEY]: JSON.stringify({
                user_id: 'not-a-uuid',
                nickname: 'Player',
                character_id: 'unknown'
            })
        });

        assert.equal(loadProfile(storage), null);
        assert.equal(storage.getItem(PROFILE_STORAGE_KEY), null);
        assert.throws(() => saveProfile({ nickname: '  ', character_id: 'bobabao' }, storage));
        assert.throws(() => saveProfile({ nickname: 'Player', character_id: 'unknown' }, storage));
        assert.throws(() =>
            saveProfile({ nickname: 'x'.repeat(33), character_id: 'bobabao' }, storage)
        );
    });

    it('replaces a removed character with Bobabao without changing the saved UUID', () => {
        const storage = createStorage({
            [PROFILE_STORAGE_KEY]: JSON.stringify({
                user_id: '11111111-1111-4111-8111-111111111111',
                nickname: 'Player',
                character_id: 'removed-character'
            })
        });

        assert.deepEqual(loadProfile(storage), {
            user_id: '11111111-1111-4111-8111-111111111111',
            nickname: 'Player',
            character_id: 'bobabao'
        });
        assert.equal(JSON.parse(storage.getItem(PROFILE_STORAGE_KEY)).character_id, 'bobabao');
    });
});
