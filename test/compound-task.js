import { Task } from "../src/index.js";

export default {
	name: "Compound tasks",
	/**
	 * Shared run: create a compound task from a spec, execute it, return results.
	 */
	async run (spec) {
		let task = Task.create({ title: "Test", ...spec }, { info: () => {} });
		return await task.run();
	},
	tests: [
		{
			name: "Subtask results",
			map: value => value?.result ?? value,
			tests: [
				{
					name: "Returns each subtask's result",
					arg: {
						subtasks: [
							{
								type: "data",
								title: "S0",
								input: [{ contents: "a", filename: "a.json" }],
							},
							{
								type: "data",
								title: "S1",
								input: [{ contents: "b", filename: "b.json" }],
							},
						],
					},
					expect: ["a", "b"],
				},
				{
					name: "Three subtasks all execute",
					arg: {
						subtasks: [
							{
								type: "data",
								title: "S0",
								input: [{ contents: 0, filename: "a.json" }],
							},
							{
								type: "data",
								title: "S1",
								input: [{ contents: 1, filename: "b.json" }],
							},
							{
								type: "data",
								title: "S2",
								input: [{ contents: 2, filename: "c.json" }],
							},
						],
					},
					expect: [0, 1, 2],
				},
			],
		},
		{
			name: "Execution order",
			description: "Tracks execution order via handleResult side effects",
			async run (spec) {
				let log = [];
				let subtasks = spec.subtasks.map((s, i) => ({
					...s,
					handleResult () {
						log.push(i);
						return i;
					},
				}));
				let task = Task.create({ title: "Test", ...spec, subtasks }, { info: () => {} });
				await task.run();
				return log;
			},
			tests: [
				{
					name: "Sequential with concurrency: 1",
					arg: {
						concurrency: 1,
						subtasks: [
							{
								type: "data",
								title: "S0",
								input: [{ contents: {}, filename: "s0.json" }],
							},
							{
								type: "data",
								title: "S1",
								input: [{ contents: {}, filename: "s1.json" }],
							},
							{
								type: "data",
								title: "S2",
								input: [{ contents: {}, filename: "s2.json" }],
							},
						],
					},
					expect: [0, 1, 2],
				},
			],
		},
		{
			name: "Error handling",
			tests: [
				{
					name: "Subtask error throws AggregateError",
					arg: {
						subtasks: [
							{
								type: "data",
								title: "Failing",
								input: [{ contents: {}, filename: "in.json" }],
								handleResult () {
									throw new Error("boom");
								},
							},
						],
					},
					throws: AggregateError,
				},
			],
		},
		{
			name: "Dry run",
			async run (spec) {
				let task = Task.create(
					{ title: "Test", ...spec },
					{ info: () => {}, dryRun: true },
				);
				return await task.run();
			},
			check: { subset: true, deep: true },
			tests: [
				{
					name: "Returns debug tree without executing subtasks",
					arg: {
						subtasks: [
							{
								type: "data",
								title: "Sub",
								input: [{ contents: {}, filename: "in.json" }],
								handleResult () {
									throw new Error("should not run");
								},
							},
						],
					},
					expect: { type: "compound" },
				},
			],
		},
	],
};
