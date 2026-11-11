import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WebSocketClient, validateEvent } from '../web/services/websocket-client.js';

const profile = {
    user_id: '11111111-1111-4111-8111-111111111111',
    nickname: 'Player One',
    character_id: 'bobabao'
};

class FakeWebSocket extends globalThis.EventTarget {
    static instances = [];

    constructor(url) {
        super();
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        FakeWebSocket.instances.push(this);
    }

    send(serializedMessage) {
        this.sent.push(JSON.parse(serializedMessage));
    }

    open() {
        this.readyState = 1;
        this.dispatchEvent(new globalThis.Event('open'));
    }

    receive(message) {
        const event = new globalThis.Event('message');
        Object.defineProperty(event, 'data', { value: JSON.stringify(message) });
        this.dispatchEvent(event);
    }

    close() {
        this.readyState = 3;
        this.dispatchEvent(new globalThis.Event('close'));
    }
}

function createClient(options = {}) {
    FakeWebSocket.instances = [];
    return new WebSocketClient({
        url: 'ws://localhost:3001',
        profile,
        WebSocketImpl: FakeWebSocket,
        reconnectDelayMs: 10,
        ...options
    });
}

describe('browser WebSocket client', () => {
    it('sends the session hello and correlates requests with server responses', async () => {
        const client = createClient();
        client.connect();
        const socket = FakeWebSocket.instances[0];
        socket.open();

        assert.equal(socket.sent[0].type, 'session.hello');
        assert.deepEqual(socket.sent[0].payload, {
            protocol_version: 1,
            ...profile
        });

        socket.receive({
            type: 'session.ready',
            request_id: socket.sent[0].request_id,
            payload: { protocol_version: 1, user_id: profile.user_id }
        });
        assert.equal(client.status, 'ready');

        const responsePromise = client.listRooms();
        const request = socket.sent[1];
        assert.equal(request.type, 'rooms.list.request');
        socket.receive({
            type: 'rooms.list',
            request_id: request.request_id,
            payload: { rooms: [] }
        });

        const response = await responsePromise;
        assert.equal(response.type, 'rooms.list');
        assert.deepEqual(response.payload.rooms, []);
    });

    it('turns correlated server errors into typed rejected promises', async () => {
        const client = createClient();
        client.connect();
        const socket = FakeWebSocket.instances[0];
        socket.open();
        socket.receive({
            type: 'session.ready',
            payload: { protocol_version: 1, user_id: profile.user_id }
        });

        const responsePromise = client.joinRoom('room-id');
        const request = socket.sent[1];
        socket.receive({
            type: 'error',
            request_id: request.request_id,
            payload: { code: 'ROOM_FULL', message: 'A sala está cheia.', retryable: false }
        });

        await assert.rejects(responsePromise, error => {
            assert.equal(error.code, 'ROOM_FULL');
            assert.equal(error.retryable, false);
            return true;
        });
    });

    it('correlates owner configuration and match start requests', async () => {
        const client = createClient();
        client.connect();
        const socket = FakeWebSocket.instances[0];
        socket.open();
        socket.receive({
            type: 'session.ready',
            payload: { protocol_version: 1, user_id: profile.user_id }
        });

        const configurePromise = client.configureRoom({ name: 'Updated room' });
        const startPromise = client.startMatch();

        assert.equal(socket.sent[1].type, 'room.configure');
        assert.equal(typeof socket.sent[1].request_id, 'string');
        assert.equal(socket.sent[2].type, 'match.start');
        assert.equal(typeof socket.sent[2].request_id, 'string');
        socket.receive({
            type: 'room.snapshot',
            request_id: socket.sent[1].request_id,
            payload: { revision: 2, room: {}, participants: [] }
        });
        socket.receive({
            type: 'match.started',
            request_id: socket.sent[2].request_id,
            payload: { room_id: 'room-id' }
        });
        await Promise.all([configurePromise, startPromise]);
        client.close();
    });

    it('rejects unsafe question events and schedules reconnect after close', () => {
        const client = createClient();
        const protocolErrors = [];
        client.addEventListener('protocol-error', event => protocolErrors.push(event.detail));
        client.connect();
        const socket = FakeWebSocket.instances[0];
        socket.open();
        socket.receive({
            type: 'question.presented',
            payload: {
                question_id: 1,
                prompt: 'Question',
                options: ['A', 'B'],
                correct_option_index: 0
            }
        });

        assert.equal(protocolErrors.length, 1);
        assert.equal(validateEvent({ type: 'unknown', payload: {} }), false);
        socket.close();
        assert.equal(client.status, 'reconnecting');
        assert.equal(client.reconnectTimer !== null, true);
        client.close();
    });
});
