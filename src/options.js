const availableOptions = {
	config: {
		short: "c",
	},
	force: {
		default: false,
		short: "f",
	},
	dryRun: {
		long: "dry-run",
	},
	itemsPerPage: {
		long: "pp",
		parse: Number,
		// 0 disables batching (overrides task-level default)
		validate: v => Number.isInteger(v) && v >= 0,
	},
	fresh: {
		default: false,
	},
	input: {
		short: "i",
	},
	output: {
		short: "o",
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
