export default {
	questionId: {
		long: "question",
		short: "q",
	},

	// Options specific to data tasks
	input: {
		short: "i",
	},
	output: {
		short: "o",
	},

	// Options specific to LLM tasks
	llm: {},
	model: {},
	thinking: {},
	itemsPerPage: {
		long: "pp",
		parse: Number,
		// 0 disables batching (overrides task-level default)
		validate: v => Number.isInteger(v) && v >= 0,
	},
	fresh: {
		default: false,
	},
	force: {
		default: false,
		short: "f",
	},
	dryRun: {
		long: "dry-run",
	},
	config: {
		short: "c",
	},
};
