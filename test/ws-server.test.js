import assert from 'node:assert/strict';
import { once } from 'node:events';
import { afterEach, describe, it } from 'node:test';
import WebSocket from 'ws';
import { closeWebSocketServer, getWebSocketConfig, startWebSocketServer } from '../ws/server.js';

const logger = {
    info() {},
    error() {}
};

let server;

afterEach(async () => {
    if (server) {
        await closeWebSocketServer(server);
        server = null;
    }
});

describe('WebSocket server bootstrap', () => {
    it('reads and validates host and port from the environment', () => {
        assert.deepEqual(getWebSocketConfig({ WS_HOST: '127.0.0.1', WS_PORT: '3100' }), {
            host: '127.0.0.1',
            port: 3100
        });
        assert.deepEqual(getWebSocketConfig({}), { host: '0.0.0.0', port: 3001 });
        assert.throws(() => getWebSocketConfig({ WS_PORT: 'invalid' }), /WS_PORT/);
        assert.throws(() => getWebSocketConfig({ WS_PORT: '65536' }), /WS_PORT/);
    });

    it('accepts a WebSocket connection and shuts down cleanly', async () => {
        server = await startWebSocketServer({ host: '127.0.0.1', port: 0, logger });
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        assert.ok(server.presence.rooms instanceof Map);
        assert.ok(server.presence.players instanceof Map);
        assert.ok(server.presence.connections instanceof Map);

        const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
        await once(client, 'open');
        assert.equal(client.readyState, WebSocket.OPEN);

        const clientClosed = once(client, 'close');
        const closedServer = server;
        await closeWebSocketServer(closedServer);
        await clientClosed;
        server = null;

        assert.equal(client.readyState, WebSocket.CLOSED);
        assert.equal(closedServer.address(), null);
    });
});
