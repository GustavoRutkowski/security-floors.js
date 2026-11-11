export function readRoomSettings(form) {
    const data = new FormData(form);
    const timeLimit = data.get('time_limit_seconds');
    return {
        name: data.get('name').trim(),
        mode: data.get('mode'),
        floors: Number(data.get('floors')),
        notebooks_per_floor: Number(data.get('notebooks_per_floor')),
        time_limit_seconds: timeLimit === '' ? null : Number(timeLimit),
        max_players: Number(data.get('max_players'))
    };
}

export function syncDeathmatchNotebooks(modeId, notebooksId, documentRef = document) {
    const mode = documentRef.getElementById(modeId);
    const notebooks = documentRef.getElementById(notebooksId);
    const deathmatch = mode.value === 'deathmatch';
    notebooks.readOnly = deathmatch;
    if (deathmatch) notebooks.value = '1';
}
