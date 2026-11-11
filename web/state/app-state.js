const INITIAL_STATE = Object.freeze({
    screen: 'profile',
    connectionStatus: 'disconnected',
    profile: null,
    rooms: [],
    selectedRoomId: null,
    roomSnapshot: null,
    matchSnapshot: null
});

export function createAppState(initialState = {}) {
    let state = { ...INITIAL_STATE, ...initialState };
    const listeners = new Set();

    return {
        getState() {
            return state;
        },
        update(update) {
            const nextState =
                typeof update === 'function' ? update(state) : { ...state, ...update };
            if (nextState === state) return state;

            state = nextState;
            for (const listener of listeners) listener(state);
            return state;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}
