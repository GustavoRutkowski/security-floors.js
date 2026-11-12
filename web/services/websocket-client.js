import { MAP_SIZE } from '../../map-layout.js';

const PROTOCOL_VERSION = 1;
const DEFAULT_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set([
    'session.ready',
    'rooms.list',
    'room.snapshot',
    'room.left',
    'match.started',
    'match.snapshot',
    'player.eliminated',
    'spectator.started',
    'spectator.following',
    'question.presented',
    'door.opened',
    'player.moved',
    'answer.result',
    'ranking.updated',
    'match.ended',
    'error'
]);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidEnvelope(message) {
    return (
        isRecord(message) &&
        typeof message.type === 'string' &&
        EVENT_TYPES.has(message.type) &&
        isRecord(message.payload) &&
        (message.request_id === undefined ||
            (typeof message.request_id === 'string' && REQUEST_ID_PATTERN.test(message.request_id)))
    );
}

function validateEvent(message) {
    if (!isValidEnvelope(message)) return false;

    if (message.type === 'error') {
        return (
            typeof message.payload.code === 'string' &&
            typeof message.payload.message === 'string' &&
            typeof message.payload.retryable === 'boolean'
        );
    }

    if (message.type === 'question.presented') {
        const { notebook_position: position, options } = message.payload;
        return (
            Number.isSafeInteger(message.payload.question_id) &&
            message.payload.question_id > 0 &&
            Number.isSafeInteger(message.payload.floor) &&
            message.payload.floor > 0 &&
            typeof message.payload.notebook_id === 'string' &&
            Number.isSafeInteger(message.payload.notebook_label) &&
            message.payload.notebook_label > 0 &&
            isRecord(position) &&
            Number.isSafeInteger(position.row) &&
            position.row >= 0 &&
            position.row < MAP_SIZE &&
            Number.isSafeInteger(position.column) &&
            position.column >= 0 &&
            position.column < MAP_SIZE &&
            Array.isArray(options) &&
            options.length >= 2 &&
            options.every(option => typeof option === 'string' && option.trim() !== '') &&
            typeof message.payload.prompt === 'string' &&
            message.payload.prompt.trim() !== '' &&
            !Object.hasOwn(message.payload, 'correct_option_index') &&
            !Object.hasOwn(message.payload, 'explanation')
        );
    }

    if (message.type === 'answer.result') {
        return (
            Number.isSafeInteger(message.payload.question_id) &&
            message.payload.question_id > 0 &&
            typeof message.payload.notebook_id === 'string' &&
            Number.isSafeInteger(message.payload.notebook_label) &&
            message.payload.notebook_label > 0 &&
            isRecord(message.payload.notebook_position) &&
            Number.isSafeInteger(message.payload.notebook_position.row) &&
            message.payload.notebook_position.row >= 0 &&
            message.payload.notebook_position.row < MAP_SIZE &&
            Number.isSafeInteger(message.payload.notebook_position.column) &&
            message.payload.notebook_position.column >= 0 &&
            message.payload.notebook_position.column < MAP_SIZE &&
            typeof message.payload.correct === 'boolean' &&
            Number.isSafeInteger(message.payload.correct_option_index) &&
            message.payload.correct_option_index >= 0 &&
            typeof message.payload.explanation === 'string' &&
            Number.isSafeInteger(message.payload.floor) &&
            message.payload.floor > 0 &&
            (message.payload.retry_after_ms === undefined ||
                (Number.isSafeInteger(message.payload.retry_after_ms) &&
                    message.payload.retry_after_ms > 0))
        );
    }

    if (message.type === 'door.opened') {
        return (
            Number.isSafeInteger(message.payload.floor) &&
            message.payload.floor > 0 &&
            ['correct_answer', 'all_notebooks_answered'].includes(message.payload.reason)
        );
    }

    if (message.type === 'spectator.started') {
        return (
            typeof message.payload.user_id === 'string' &&
            UUID_PATTERN.test(message.payload.user_id) &&
            (message.payload.target_user_id === null ||
                (typeof message.payload.target_user_id === 'string' &&
                    UUID_PATTERN.test(message.payload.target_user_id))) &&
            ['wrong_answer', 'reconnect_expired', 'run_finished'].includes(message.payload.reason)
        );
    }

    if (message.type === 'spectator.following') {
        return (
            message.payload.target_user_id === null ||
            (typeof message.payload.target_user_id === 'string' &&
                UUID_PATTERN.test(message.payload.target_user_id))
        );
    }

    if (message.type === 'match.snapshot') {
        return (
            isRecord(message.payload.viewer) &&
            ['playing', 'eliminated', 'finished'].includes(message.payload.viewer.status) &&
            (message.payload.viewer.target_user_id === null ||
                (typeof message.payload.viewer.target_user_id === 'string' &&
                    UUID_PATTERN.test(message.payload.viewer.target_user_id))) &&
            Array.isArray(message.payload.players)
        );
    }

    if (message.type === 'session.ready') {
        return (
            message.payload.protocol_version === PROTOCOL_VERSION &&
            typeof message.payload.user_id === 'string' &&
            UUID_PATTERN.test(message.payload.user_id)
        );
    }

    return true;
}

function defaultRequestId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class WebSocketClient extends EventTarget {
    constructor({
        url,
        profile,
        WebSocketImpl = globalThis.WebSocket,
        reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
        maxReconnectDelayMs = MAX_RECONNECT_DELAY_MS,
        setTimeoutFn = globalThis.setTimeout,
        clearTimeoutFn = globalThis.clearTimeout
    } = {}) {
        super();
        if (typeof url !== 'string' || url.trim() === '')
            throw new TypeError('WebSocket URL is required.');
        if (!isRecord(profile) || !UUID_PATTERN.test(profile.user_id)) {
            throw new TypeError('A valid profile is required.');
        }
        if (typeof WebSocketImpl !== 'function') {
            throw new Error('WebSocket is unavailable in this browser.');
        }

        this.url = url;
        this.profile = { ...profile };
        this.WebSocketImpl = WebSocketImpl;
        this.reconnectDelayMs = Math.max(0, reconnectDelayMs);
        this.maxReconnectDelayMs = Math.max(this.reconnectDelayMs, maxReconnectDelayMs);
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.socket = null;
        this.status = 'disconnected';
        this.reconnectAttempt = 0;
        this.reconnectTimer = null;
        this.closedByUser = false;
        this.pendingRequests = new Map();
    }

    connect() {
        if (this.status === 'connecting' || this.status === 'open' || this.status === 'ready')
            return;
        this.closedByUser = false;
        this.clearReconnectTimer();
        this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
        const socket = new this.WebSocketImpl(this.url);
        this.socket = socket;
        socket.addEventListener('open', () => this.handleOpen(socket));
        socket.addEventListener('message', event => this.handleMessage(event));
        socket.addEventListener('error', event => this.dispatch('error', event));
        socket.addEventListener('close', () => this.handleClose(socket));
    }

    close() {
        this.closedByUser = true;
        this.clearReconnectTimer();
        if (this.socket && this.socket.readyState < 2) this.socket.close(1000, 'Client closed');
        this.socket = null;
        this.rejectPending(new Error('WebSocket client closed.'));
        this.setStatus('closed');
    }

    request(type, payload = {}, requestId = defaultRequestId()) {
        if (this.status !== 'ready')
            return Promise.reject(new Error('WebSocket session is not ready.'));
        if (!REQUEST_ID_PATTERN.test(requestId))
            return Promise.reject(new TypeError('Invalid request ID.'));
        if (!isRecord(payload))
            return Promise.reject(new TypeError('Message payload must be an object.'));

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });
            try {
                this.send({ type, request_id: requestId, payload });
            } catch (error) {
                this.pendingRequests.delete(requestId);
                reject(error);
            }
        });
    }

    sendIntent(type, payload = {}) {
        if (this.status !== 'ready') throw new Error('WebSocket session is not ready.');
        if (!isRecord(payload)) throw new TypeError('Message payload must be an object.');
        this.send({ type, payload });
    }

    listRooms() {
        return this.request('rooms.list.request');
    }

    createRoom(settings) {
        return this.request('room.create', settings);
    }

    joinRoom(roomId) {
        return this.request('room.join', { room_id: roomId });
    }

    leaveRoom() {
        return this.request('room.leave');
    }

    configureRoom(settings) {
        return this.request('room.configure', settings);
    }

    startMatch() {
        return this.request('match.start');
    }

    move(sequence, direction) {
        this.sendIntent('player.move', { sequence, direction });
    }

    answer(questionId, optionIndex) {
        return this.request('question.answer', {
            question_id: questionId,
            option_index: optionIndex
        });
    }

    followSpectator(targetUserId) {
        return this.request('spectator.follow', { target_user_id: targetUserId });
    }

    handleOpen(socket) {
        if (socket !== this.socket) return;
        this.reconnectAttempt = 0;
        this.setStatus('open');
        this.send({
            type: 'session.hello',
            request_id: defaultRequestId(),
            payload: {
                protocol_version: PROTOCOL_VERSION,
                user_id: this.profile.user_id,
                nickname: this.profile.nickname,
                character_id: this.profile.character_id
            }
        });
    }

    handleClose(socket) {
        if (socket !== this.socket) return;
        this.socket = null;
        this.rejectPending(new Error('WebSocket connection closed.'));
        if (this.closedByUser) {
            this.setStatus('closed');
            return;
        }
        this.setStatus('reconnecting');
        this.scheduleReconnect();
    }

    handleMessage(event) {
        let message;
        try {
            message = JSON.parse(
                typeof event.data === 'string' ? event.data : event.data.toString()
            );
        } catch {
            this.dispatch('protocol-error', {
                code: 'INVALID_MESSAGE',
                message: 'Resposta não é JSON válido.'
            });
            return;
        }

        if (!validateEvent(message)) {
            this.dispatch('protocol-error', {
                code: 'INVALID_MESSAGE',
                message: 'Evento WS inválido.'
            });
            return;
        }

        if (message.type === 'session.ready') this.setStatus('ready');
        const pending = message.request_id ? this.pendingRequests.get(message.request_id) : null;
        if (pending) {
            this.pendingRequests.delete(message.request_id);
            if (message.type === 'error') pending.reject(this.createServerError(message.payload));
            else pending.resolve(message);
        }
        this.dispatch(message.type, message);
        this.dispatch('message', message);
    }

    send(message) {
        if (!this.socket || this.socket.readyState !== 1) throw new Error('WebSocket is not open.');
        this.socket.send(JSON.stringify(message));
    }

    scheduleReconnect() {
        if (this.reconnectTimer !== null) return;
        const delay = Math.min(
            this.reconnectDelayMs * 2 ** this.reconnectAttempt,
            this.maxReconnectDelayMs
        );
        this.reconnectAttempt += 1;
        this.reconnectTimer = this.setTimeoutFn(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    clearReconnectTimer() {
        if (this.reconnectTimer === null) return;
        this.clearTimeoutFn(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    rejectPending(error) {
        for (const { reject } of this.pendingRequests.values()) reject(error);
        this.pendingRequests.clear();
    }

    createServerError(payload) {
        const error = new Error(payload.message);
        error.code = payload.code;
        error.retryable = payload.retryable;
        return error;
    }

    setStatus(status) {
        if (this.status === status) return;
        this.status = status;
        this.dispatch('status', { status });
    }

    dispatch(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }
}

export { isValidEnvelope, validateEvent };
