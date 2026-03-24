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

export function resolveOptions (options) {
	let ret = {};

	for (let key in availableOptions) {
		if (key in options) {
			let value = options[key];

			if (option.parse) {
				value = option.parse(value);
			}

			if (option.validate && !option.validate(value)) {
				// Ignore invalid values
				value = undefined;
			}
		}

		ret[key] = value ?? option.default;
	}

	return ret;
}

export default availableOptions;
