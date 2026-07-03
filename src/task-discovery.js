/**
 * Task querying.
 * Tasks are referenced by queries: any trailing part of a task's path, with
 * directory separators written as `/` or collapsed into `-`, optionally with
 * the file's extension (needed when tasks differ only by extension).
 */

/**
 * Resolve a task query to the single closest matching path.
 * @param {string} query
 * @param {string[]} paths
 * @returns {string}
 * @throws If no task matches, or several match equally well
 */
export function resolveTasks (query, paths) {
	let matches = rankMatches(query, paths);

	if (matches.length === 0) {
		if (paths.length === 0) {
			throw new Error(`No task files found. Check the "tasks" config option.`);
		}

		let ids = paths.map(path => taskId(path, paths)).sort();
		throw new Error(`Invalid task "${query}". Available tasks: ${ids.join(", ")}`);
	}

	let [best] = matches;
	return matches.filter(m => sameRank(m, best));
}

export function resolveTask (query, paths) {
	let tied = resolveTasks(query, paths);

	if (tied.length > 1) {
		let ids = tied.map(m => taskId(m.path, paths));
		throw new Error(
			`Ambiguous task "${query}": matches ${ids.join(", ")}. Use a more specific reference.`,
		);
	}

	return tied[0].path;
}

/**
 * The shortest query that uniquely identifies a task among its peers; used as its id.
 * Extension-qualified only when needed (extension twins), then the slash path.
 * @param {string} path
 * @param {string[]} paths
 * @returns {string}
 */
export function taskId (path, paths) {
	let stems = stripExtension(path).split("/");
	let full = path.split("/");

	let candidates = [stems, full].flatMap(segments =>
		segments.map((_, i) => segments.slice(-(i + 1)).join("-")));
	candidates.push(stripExtension(path));

	for (let query of candidates) {
		let [best, second] = rankMatches(query, paths);

		if (best.path === path && (!second || !sameRank(best, second))) {
			return query;
		}
	}

	// The full path always matches itself uniquely
	return path;
}

/**
 * All tasks matching a query, closest first. A match anchors at the end of the path;
 * fewer leading segments before it wins, then fewer separators collapsed into `-`
 * (so `foo-bar` prefers the file `foo-bar.js`, while `foo/bar` targets `foo/bar.js`).
 * The query may include the file's extension, which then must match —
 * so `build.mjs` never resolves to `build.js`.
 */
function rankMatches (query, paths) {
	let parts = query.split("/");
	let matches = [];

	for (let path of paths) {
		let segments = stripExtension(path).split("/");
		// The query may include the extension; try the stem first, then the full path
		let start = matchSuffix(parts, segments) ?? matchSuffix(parts, path.split("/"));

		if (start !== null) {
			matches.push({
				path,
				unconsumed: start,
				collapsed: segments.length - start - parts.length,
			});
		}
	}

	return matches.sort((a, b) => a.unconsumed - b.unconsumed || a.collapsed - b.collapsed);
}

function sameRank (a, b) {
	return a.unconsumed === b.unconsumed && a.collapsed === b.collapsed;
}

function stripExtension (path) {
	return path.replace(/\.[^./]+$/, "");
}

/**
 * Match query parts against a suffix of a task's path segments.
 * Each part must equal one or more consecutive segments joined by `-`
 * (filenames may themselves contain hyphens, so parts are never split),
 * and the last part must end at the filename segment.
 * @param {string[]} parts Query split on `/`
 * @param {string[]} segments Task path split on `/`
 * @returns {number | null} The smallest segment index where a match can start, or null
 */
function matchSuffix (parts, segments) {
	// Right-to-left backtracking: fit parts[0..partIndex] against segments ending at `end`.
	let fit = (partIndex, end) => {
		let part = parts[partIndex];
		let best = null;

		for (let start = end - 1; start >= 0; start--) {
			let candidate = segments.slice(start, end).join("-");

			if (candidate.length > part.length) {
				// Prepending more segments only grows the candidate — stop.
				break;
			}

			if (candidate === part) {
				let s = partIndex === 0 ? start : fit(partIndex - 1, start);

				if (s !== null && (best === null || s < best)) {
					best = s;
				}
			}
		}

		return best;
	};

	return fit(parts.length - 1, segments.length);
}
