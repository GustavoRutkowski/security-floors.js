import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAppState } from '../web/state/app-state.js';

describe('browser application state', () => {
    it('merges updates and notifies subscribers with the latest state', () => {
        const state = createAppState({ screen: 'home' });
        const observedStates = [];
        state.subscribe(nextState => observedStates.push(nextState));

        state.update({ selectedRoomId: 'room-1' });

        assert.deepEqual(state.getState(), {
            screen: 'home',
            connectionStatus: 'disconnected',
            profile: null,
            rooms: [],
            selectedRoomId: 'room-1',
            roomSnapshot: null,
            matchSnapshot: null
        });
        assert.equal(observedStates.length, 1);
        assert.equal(observedStates[0], state.getState());
    });

    it('stops notifying after a subscriber unsubscribes', () => {
        const state = createAppState();
        let notificationCount = 0;
        const unsubscribe = state.subscribe(() => {
            notificationCount += 1;
        });

        state.update({ screen: 'home' });
        unsubscribe();
        state.update({ screen: 'lobby' });

        assert.equal(notificationCount, 1);
    });
});
