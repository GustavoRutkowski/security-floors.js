CREATE TABLE IF NOT EXISTS rooms (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	mode TEXT NOT NULL CHECK (mode IN ('classic', 'deathmatch')),
	floors INTEGER NOT NULL CHECK (floors BETWEEN 3 AND 30),
	notebooks_per_floor INTEGER NOT NULL CHECK (notebooks_per_floor BETWEEN 1 AND 6),
	time_limit_seconds INTEGER CHECK (time_limit_seconds IS NULL OR time_limit_seconds >= 60),
	max_players INTEGER NOT NULL CHECK (max_players >= 1),
	status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing')),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	CHECK (mode != 'deathmatch' OR notebooks_per_floor = 1)
);

CREATE INDEX IF NOT EXISTS rooms_status_created_at_idx
	ON rooms (status, created_at);

CREATE TABLE IF NOT EXISTS questions (
	id INTEGER PRIMARY KEY,
	prompt TEXT NOT NULL,
	options TEXT NOT NULL CHECK (
		json_valid(options)
		AND json_type(options) = 'array'
		AND json_array_length(options) >= 2
	),
	correct_option_index INTEGER NOT NULL CHECK (
		correct_option_index >= 0
		AND correct_option_index < json_array_length(options)
	),
	explanation TEXT
);
