import { CHARACTERS, DEFAULT_CHARACTER_ID } from './character-catalog.js';

export const PROFILE_STORAGE_KEY = 'security-floors.profile.v1';

export { CHARACTERS };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHARACTER_IDS = new Set(CHARACTERS.map(character => character.id));

function isValidProfile(profile) {
    return (
        profile !== null &&
        typeof profile === 'object' &&
        typeof profile.user_id === 'string' &&
        UUID_PATTERN.test(profile.user_id) &&
        typeof profile.nickname === 'string' &&
        profile.nickname.trim() !== '' &&
        profile.nickname.length <= 32
    );
}

export function createUserId(cryptoApi = globalThis.crypto) {
    if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
    if (typeof cryptoApi?.getRandomValues !== 'function') {
        throw new Error('Secure UUID generation is unavailable in this browser.');
    }

    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function loadProfile(storage = globalThis.localStorage) {
    if (!storage) return null;

    try {
        const serializedProfile = storage.getItem(PROFILE_STORAGE_KEY);
        if (!serializedProfile) return null;

        const profile = JSON.parse(serializedProfile);
        if (isValidProfile(profile)) {
            const normalizedProfile = {
                user_id: profile.user_id,
                nickname: profile.nickname,
                character_id: CHARACTER_IDS.has(profile.character_id)
                    ? profile.character_id
                    : DEFAULT_CHARACTER_ID
            };
            if (normalizedProfile.character_id !== profile.character_id) {
                storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalizedProfile));
            }
            return normalizedProfile;
        }

        storage.removeItem(PROFILE_STORAGE_KEY);
    } catch {
        try {
            storage.removeItem(PROFILE_STORAGE_KEY);
        } catch {
            return null;
        }
    }

    return null;
}

export function saveProfile({ nickname, character_id }, storage = globalThis.localStorage) {
    if (!storage) throw new Error('Local profile storage is unavailable in this browser.');
    if (typeof nickname !== 'string' || nickname.trim() === '' || nickname.trim().length > 32) {
        throw new TypeError('Nickname must contain between 1 and 32 characters.');
    }
    if (!CHARACTER_IDS.has(character_id)) throw new TypeError('Select an available character.');

    const existingProfile = loadProfile(storage);
    const profile = {
        user_id: existingProfile?.user_id ?? createUserId(),
        nickname: nickname.trim(),
        character_id
    };
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    return profile;
}
