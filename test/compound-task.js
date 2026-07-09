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
			name: "Option-driven fan-out",
			tests: [
				{
					name: "Multi-valued option with array > 1 fans out",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: { target: { multiple: true, present: true } },
								input: [{ contents: {}, filename: "in.json" }],
							},
							{ info: () => {}, options: { target: ["a", "b", "c"] } },
						);
						return task.computedSubtasks.length;
					},
					expect: 3,
				},
				{
					name: "Multi-valued option with single value does not fan out",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: { target: { multiple: true, present: true } },
								input: [{ contents: {}, filename: "in.json" }],
							},
							{ info: () => {}, options: { target: "a" } },
						);
						return task.computedSubtasks.length;
					},
					expect: 0,
				},
				{
					name: "Multi-valued option with array of 1 does not fan out",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: { target: { multiple: true, present: true } },
								input: [{ contents: {}, filename: "in.json" }],
							},
							{ info: () => {}, options: { target: ["only"] } },
						);
						return task.computedSubtasks.length;
					},
					expect: 0,
				},
				{
					name: "Explicit `positional: false` is still a valid fan-out driver",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: { target: { multiple: true, positional: false, present: true } },
								input: [{ contents: {}, filename: "in.json" }],
							},
							{ info: () => {}, options: { target: ["a", "b"] } },
						);
						return task.computedSubtasks.length;
					},
					expect: 2,
				},
				{
					name: "Optional multi-valued option does not fan out (inheritance noise)",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: { target: { multiple: true } },
								input: [{ contents: {}, filename: "in.json" }],
							},
							{ info: () => {}, options: { target: ["a", "b", "c"] } },
						);
						return task.computedSubtasks.length;
					},
					expect: 0,
				},
				{
					name: "Positional `multiple: true` is not a fan-out driver",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: { rest: { multiple: true, positional: true } },
								input: [{ contents: {}, filename: "in.json" }],
							},
							{ info: () => {}, options: { rest: ["a", "b", "c"] } },
						);
						return task.computedSubtasks.length;
					},
					expect: 0,
				},
				{
					name: "Two multi-valued drivers throws",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: {
									a: { multiple: true, present: true },
									b: { multiple: true, present: true },
								},
								input: [{ contents: {}, filename: "in.json" }],
							},
							{ info: () => {}, options: { a: [1, 2], b: ["x", "y"] } },
						);
						return task.computedSubtasks;
					},
					throws: /Ambiguous fan-out/,
				},
				{
					name: "Driver passed in via kebab alias doesn't leak to subtask under alias key",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: {
									targetEnv: { long: "target-env", multiple: true, present: true },
								},
								input: [{ contents: {}, filename: "in.json" }],
							},
							{
								info: () => {},
								// Mirrors how the CLI parses `--target-env a --target-env b` —
								// the kebab alias is the bag key, not the canonical name.
								options: { "target-env": ["a", "b"] },
							},
						);
						let [first] = task.computedSubtasks;
						return {
							canonical: first.targetEnv,
							kebabInTask: first.task["target-env"],
							kebabInUnknown: first.unknownOptions["target-env"],
						};
					},
					// Bug regression: subtask used to carry the parent's full array
					// under "target-env" via the unknown-options escape hatch.
					expect: {
						canonical: ["a"],
						kebabInTask: undefined,
						kebabInUnknown: undefined,
					},
				},
				{
					name: "Fan-out driver takes precedence over batching",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								itemsPerPage: 1,
								options: { target: { multiple: true, present: true } },
								input: [
									{ contents: [1, 2, 3], filename: "in.json", paginate: true },
								],
								output: { filename: "out.json" },
							},
							{ info: () => {}, options: { target: ["a", "b"] } },
						);
						// Bug regression: batching used to win, slicing the first value's
						// input at the parent, then each slice re-fanned out across values.
						return {
							replicas: task.computedSubtasks.length,
							batchesPerReplica: task.computedSubtasks[0].computedSubtasks.length,
						};
					},
					expect: { replicas: 2, batchesPerReplica: 3 },
				},
				{
					name: "force propagates from parent to fan-out subtasks",
					description:
						"force is stripped from rawOptions by Task.fromPath and passed as a dedicated constructor arg (mirrored here), so subtasks must inherit it via this.parent.force rather than re-resolving their own default.",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: { target: { multiple: true, present: true } },
								input: [{ contents: {}, filename: "in.json" }],
							},
							{ info: () => {}, force: true, options: { target: ["a", "b"] } },
						);
						return task.computedSubtasks.map(t => t.force);
					},
					expect: [true, true],
				},
				{
					name: "Explicit subtasks win over option-driven fan-out",
					run: () => {
						let task = Task.create(
							{
								type: "data",
								options: { target: { multiple: true, present: true } },
								input: [{ contents: {}, filename: "in.json" }],
								subtasks: [
									{
										type: "data",
										input: [{ contents: {}, filename: "s.json" }],
									},
								],
							},
							{ info: () => {}, options: { target: ["a", "b", "c"] } },
						);
						return task.computedSubtasks.length;
					},
					expect: 1,
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
