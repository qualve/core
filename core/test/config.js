import Config from "../src/config.js";

// A config-contributed option marked `for: "config"` is resolved and owned by Config.
// (The `tasks` built-in is the only other config-scoped option.)
const CONFIG_OPTION = { threshold: { for: "config", parse: Number, default: 5 } };
// A plain (task) option is not resolved by Config.
const TASK_OPTION = { limit: { parse: Number } };

export default {
	name: "Config option resolution",
	tests: [
		{
			name: "Config option is normalized via its parse",
			run: async () =>
				(await Config.from({ options: CONFIG_OPTION, threshold: "42" })).threshold,
			expect: 42,
		},
		{
			name: "Config option falls back to its default",
			run: async () => (await Config.from({ options: CONFIG_OPTION })).threshold,
			expect: 5,
		},
		{
			name: "Override wins over the config file",
			run: async () =>
				(
					await Config.from(
						{ options: CONFIG_OPTION, threshold: "42" },
						{ threshold: "99" },
					)
				).threshold,
			expect: 99,
		},
		{
			name: "Task options are left raw — Config doesn't resolve them",
			run: async () => (await Config.from({ options: TASK_OPTION, limit: "42" })).limit,
			expect: "42",
		},
		{
			name: "Missing auto-discovered config falls back to defaults",
			run: async () => Object.keys(await Config.resolveConfig()).length,
			expect: 0,
		},
		{
			name: "Explicitly-provided missing config throws",
			run: () => Config.resolveConfig("./does-not-exist.config.js"),
			throws: e => /Could not load config/.test(e.message),
		},
	],
};
