import {
    CHARACTERS,
    DEFAULT_CHARACTER_ID,
    getCharacter
} from '../../services/character-catalog.js';
import { getCharacterSpriteUrl } from '../../services/character-assets.js';
import { loadProfile, saveProfile } from '../../services/profile-storage.js';

export function createProfileFeature({ onProfileReady, onEditProfile, documentRef = document }) {
    const profileForm = documentRef.getElementById('profile-form');
    const nicknameInput = documentRef.getElementById('nickname');
    const profileError = documentRef.getElementById('profile-error');
    const characterGrid = documentRef.getElementById('character-grid');

    function updateCharacterPreview(characterId) {
        const character = getCharacter(characterId) ?? getCharacter(DEFAULT_CHARACTER_ID);
        const preview = documentRef.getElementById('character-preview');
        const stage = documentRef.getElementById('preview-stage');

        preview.dataset.character = character.id;
        preview.style.backgroundImage = `url("${getCharacterSpriteUrl(character)}")`;
        preview.setAttribute('aria-label', character.name);
        stage.dataset.character = character.id;
        documentRef.getElementById('preview-name').textContent = character.name;
        documentRef.getElementById('preview-index').textContent =
            `CHAR / ${String(CHARACTERS.indexOf(character) + 1).padStart(2, '0')}`;
    }

    function renderCharacters() {
        characterGrid.replaceChildren();
        documentRef.getElementById('character-count').textContent =
            `/// ${String(CHARACTERS.length).padStart(2, '0')}`;

        for (const [index, character] of CHARACTERS.entries()) {
            const choice = documentRef.createElement('label');
            choice.className = 'character-choice';
            const input = documentRef.createElement('input');
            input.type = 'radio';
            input.name = 'character_id';
            input.value = character.id;
            input.required = true;
            input.checked = character.id === DEFAULT_CHARACTER_ID;

            const body = documentRef.createElement('span');
            body.className = 'character-choice-body';
            const top = documentRef.createElement('span');
            top.className = 'character-choice-top';
            const sprite = documentRef.createElement('span');
            sprite.className = 'character-sprite character-sprite-small';
            sprite.dataset.character = character.id;
            sprite.style.backgroundImage = `url("${getCharacterSpriteUrl(character)}")`;
            sprite.setAttribute('aria-hidden', 'true');
            const indexLabel = documentRef.createElement('span');
            indexLabel.className = 'choice-index';
            indexLabel.textContent = String(index + 1).padStart(2, '0');
            const name = documentRef.createElement('span');
            name.className = 'character-name';
            name.textContent = character.name;
            const state = documentRef.createElement('span');
            state.className = 'choice-state';
            state.textContent = 'SELECIONAR';

            top.append(sprite, indexLabel);
            body.append(top, name, state);
            choice.append(input, body);
            characterGrid.append(choice);

            input.addEventListener('change', () => {
                if (input.checked) updateCharacterPreview(input.value);
            });
            input.addEventListener('focus', () => {
                choice.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
        }

        updateCharacterPreview(DEFAULT_CHARACTER_ID);
    }

    function applyProfile(profile) {
        if (!profile) return;
        nicknameInput.value = profile.nickname;
        const characterInputs = [...characterGrid.querySelectorAll('input[name="character_id"]')];
        const selectedInput = characterInputs.find(input => input.value === profile.character_id);
        if (selectedInput) selectedInput.checked = true;
        updateCharacterPreview(profile.character_id);

        const character = getCharacter(profile.character_id) ?? getCharacter(DEFAULT_CHARACTER_ID);
        documentRef.getElementById('home-nickname').textContent = profile.nickname;
        documentRef.getElementById('home-character-name').textContent =
            `${character.name} / CHAR ${String(CHARACTERS.indexOf(character) + 1).padStart(2, '0')}`;
        const homeCharacter = documentRef.getElementById('home-character');
        homeCharacter.dataset.character = character.id;
        homeCharacter.style.backgroundImage = `url("${getCharacterSpriteUrl(character)}")`;
    }

    profileForm.addEventListener('submit', event => {
        event.preventDefault();
        profileError.hidden = true;

        const selectedCharacter = characterGrid.querySelector(
            'input[name="character_id"]:checked'
        )?.value;
        if (!selectedCharacter) {
            showError('Selecione um personagem para continuar.');
            return;
        }

        try {
            const profile = saveProfile({
                nickname: nicknameInput.value,
                character_id: selectedCharacter
            });
            applyProfile(profile);
            onProfileReady(profile);
            window.dispatchEvent(
                new CustomEvent('security-floors:profile-ready', { detail: profile })
            );
        } catch (error) {
            profileError.textContent =
                error.message || 'Não foi possível salvar o perfil neste navegador.';
            profileError.hidden = false;
            if (!nicknameInput.value.trim()) nicknameInput.focus();
        }
    });

    documentRef.getElementById('submit-profile').addEventListener('click', () => {
        profileForm.requestSubmit();
    });
    nicknameInput.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        profileForm.requestSubmit();
    });

    try {
        renderCharacters();
    } catch (error) {
        showError(`Não foi possível carregar os personagens: ${error.message}`);
    }

    documentRef.getElementById('edit-profile').addEventListener('click', () => {
        onEditProfile();
        applyProfile(loadProfile());
        nicknameInput.focus();
    });

    function showError(message) {
        profileError.textContent = message;
        profileError.hidden = false;
    }

    return { applyProfile, showError };
}
