import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createPresenceState } from './presence.js';
import { attachRoomProtocol } from './room-protocol.js';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3001;
const SHUTDOWN_TIMEOUT_MS = 5000;

export function getWebSocketConfig(env = process.env) {
    const host = env.WS_HOST?.trim() || DEFAULT_HOST;
    const portValue = env.WS_PORT?.trim() || String(DEFAULT_PORT);
    const port = Number(portValue);

    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new RangeError('WS_PORT must be an integer between 0 and 65535');
    }

    return { host, port };
}

export function createWebSocketServer({
    host,
    port,
    logger = console,
    presence = createPresenceState(),
    database
} = {}) {
    const defaults = getWebSocketConfig();
    const server = new WebSocketServer({
        host: host ?? defaults.host,
        port: port ?? defaults.port
    });
    server.presence = presence;
    attachRoomProtocol(server, { database, presence, logger });

    server.on('connection', socket => {
        logger.info('WebSocket client connected');
        socket.on('error', error => logger.error('WebSocket client error:', error.message));
        socket.on('close', () => logger.info('WebSocket client disconnected'));
    });

    server.on('error', error => logger.error('WebSocket server error:', error.message));

    return server;
}

export async function startWebSocketServer(options = {}) {
    const logger = options.logger ?? console;
    const server = createWebSocketServer({ ...options, logger });

    await new Promise((resolveListening, rejectListening) => {
        server.once('listening', resolveListening);
        server.once('error', rejectListening);
    });

    const address = server.address();
    const host = typeof address === 'object' && address !== null ? address.address : options.host;
    const port = typeof address === 'object' && address !== null ? address.port : options.port;
    logger.info(`WebSocket server listening on ws://${host}:${port}`);

    return server;
}

export function closeWebSocketServer(server) {
    if (server.address() === null) return Promise.resolve();

    return new Promise((resolveClose, rejectClose) => {
        const clients = [...server.clients];
        const clientsClosed = clients.map(client => {
            if (client.readyState === WebSocket.CLOSED) return Promise.resolve();
            return new Promise(resolveClientClosed => client.once('close', resolveClientClosed));
        });
        const timeout = setTimeout(() => {
            for (const client of clients) {
                if (client.readyState !== WebSocket.CLOSED) client.terminate();
            }
        }, SHUTDOWN_TIMEOUT_MS);
        timeout.unref();

        for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1001, 'Server shutting down');
            }
        }

        server.close(error => {
            if (error) {
                clearTimeout(timeout);
                rejectClose(error);
                return;
            }

            Promise.all(clientsClosed).then(() => {
                clearTimeout(timeout);
                resolveClose();
            }, rejectClose);
        });
    });
}

async function runServer() {
    const { default: database } = await import('../db/connection.js');
    const server = await startWebSocketServer({ database });
    let shuttingDown = false;

    const shutdown = signal => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.info(`Received ${signal}; closing WebSocket server`);

        closeWebSocketServer(server).catch(error => {
            console.error('Failed to close WebSocket server:', error);
            process.exitCode = 1;
        });
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    runServer().catch(error => {
        console.error('Failed to start WebSocket server:', error);
        process.exitCode = 1;
    });
}
