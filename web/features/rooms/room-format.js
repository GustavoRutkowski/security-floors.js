export function formatRoomMode(mode) {
    return mode === 'deathmatch' ? 'MATA-MATA' : 'CLÁSSICO';
}

export function roomTimeLabel(seconds) {
    return seconds === null ? 'SEM LIMITE' : `${seconds} SEGUNDOS`;
}
