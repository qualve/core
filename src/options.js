const availableOptions = {
	taskId: {
		long: "task",
		positional: true,
		description: "Task to run",
	},
	config: {
		short: "c",
		description: "Path to config file",
	},
	force: {
		default: false,
		short: "f",
		description: "Force overwrite of existing output",
	},
	dryRun: {
		long: "dry-run",
		description: "Preview changes without writing files",
	},
	itemsPerPage: {
		long: "items-per-page",
		short: "pp",
		parse: Number,
		// 0 disables batching (overrides task-level default)
		validate: v => Number.isInteger(v) && v >= 0,
		description: "Number of items per batch (0 to disable)",
	},
	fresh: {
		default: false,
		description: "Ignore cached data and reprocess",
	},
	input: {
		short: "i",
		description: "Input file or directory",
	},
	output: {
		short: "o",
		description: "Output file or directory",
	},
	help: {
		description: "Show this help message",
	},
};

/**
 * Resolve raw option values against available option definitions.
 * Applies parsing, validation, and defaults.
 * @param {object} options - Raw option key-value pairs
 * @returns {object} Resolved options
 */
export function resolveOptions (options) {
	let ret = {};

	for (let key in availableOptions) {
		let option = availableOptions[key];
		let value;

		if (key in options) {
			value = options[key];

			if (option.parse) {
				value = option.parse(value);
			}

			if (option.validate && !option.validate(value)) {
				value = undefined;
			}
		}

		ret[key] = value ?? option.default;
	}

	return ret;
}

export default availableOptions;
