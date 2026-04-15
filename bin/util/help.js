/**
 * Print formatted help text for the qualve CLI.
 * @param {object} options - The availableOptions object (key → option definition)
 * @param {string[]} taskIds - Available task IDs
 */
export function printHelp (options, taskIds) {
	let lines = ["Usage: qualve <task> [options]", "", "Options:"];

	// Filter out positional-only options (no flag to show in help)
	let flagOptions = Object.entries(options).filter(([key, opt]) => !opt.positional || opt.short || opt.long);

	let entries = [];
	let maxShortLen = 0;
	for (let [, opt] of flagOptions) {
		if (opt.short) {
			maxShortLen = Math.max(maxShortLen, opt.short.length + 1); // +1 for the dash
		}
	}

	for (let [key, opt] of flagOptions) {
		let long = `--${opt.long ?? key}`;
		let short = opt.short ? `-${opt.short},` : "";
		// +2 for the ", " separator between short and long
		let flag = `  ${short.padEnd(maxShortLen + 2)}${long}`;
		entries.push({ flag, description: opt.description ?? "" });
	}

	let maxFlagLen = Math.max(...entries.map(e => e.flag.length));

	for (let { flag, description } of entries) {
		lines.push(flag.padEnd(maxFlagLen + 2) + description);
	}

	if (taskIds?.length) {
		lines.push("", "Available tasks:", ...taskIds.map(id => `  ${id}`));
	}

	console.info(lines.join("\n"));
}
