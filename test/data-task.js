import { Task } from "../src/index.js";
import File from "../src/file.js";

const __dirname = new URL(".", import.meta.url).pathname;

export default {
	name: "DataTask",
	/**
	 * Shared run for all DataTask tests. Behavior is toggled via inherited `data`:
	 * - `data.dryRun: true` — create the task with `dryRun: true`
	 * - `data.full: true`   — return the full `run()` return value instead of projecting to `result`
	 */
	async run (spec) {
		let task = Task.create(
			{ type: "data", title: "Test", ...spec },
			{ info: () => {}, dryRun: this.data?.dryRun },
		);
		let ret = await task.run();
		return this.data?.full ? ret : (ret?.result ?? ret);
	},
	tests: [
		{
			name: "Single file passthrough",
			arg: { input: [{ contents: { greeting: "hello" }, filename: "in.json" }] },
			expect: { greeting: "hello" },
		},
		{
			name: "resultType: array",
			arg: {
				resultType: "array",
				input: [
					{ contents: { a: 1 }, filename: "a.json" },
					{ contents: { b: 2 }, filename: "b.json" },
				],
			},
			expect: [{ a: 1 }, { b: 2 }],
		},
		{
			name: "resultType: files gives one array of File objects",
			arg: {
				resultType: "files",
				input: [
					{ contents: { x: 1 }, filename: "x.json" },
					{ contents: { y: 2 }, filename: "y.json" },
				],
			},
			map: value => value?.filename ?? value,
			expect: ["x.json", "y.json"],
		},
		{
			name: "handleResult transforms data",
			arg: {
				input: [{ contents: [1, 2, 3], filename: "nums.json" }],
				handleResult: data => data.map(n => n * 2),
			},
			expect: [2, 4, 6],
		},
		{
			name: "Plain text file passthrough",
			arg: { input: [{ contents: "Hello, world!", filename: "greeting.txt" }] },
			expect: "Hello, world!",
		},
		{
			name: "Array of mixed file types",
			arg: {
				resultType: "array",
				input: [
					{ contents: { a: 1 }, filename: "data.json" },
					{ contents: "plain text", filename: "note.txt" },
					{ contents: "key=value", filename: "config.ini" },
				],
			},
			expect: [{ a: 1 }, "plain text", "key=value"],
		},
		{
			name: "Reads non-JSON files from disk",
			description: "Text files read from test/files/ should return their raw string contents",
			arg: { input: [{ filename: __dirname + "files/greeting.txt" }] },
			expect: "Hello, world!",
		},
		{
			name: "Reads multiple non-JSON files from disk",
			arg: {
				resultType: "array",
				input: [
					{ filename: __dirname + "files/greeting.txt" },
					{ filename: __dirname + "files/notes.txt" },
				],
			},
			expect: [
				"Hello, world!",
				"These are some plain text notes.\nThey span multiple lines.\nThat's all.",
			],
		},
		{
			name: "Promise contents",
			description: "handleResult should receive resolved values, not promises",
			arg: {
				input: [{
					contents: new Promise(resolve => setTimeout(() => resolve([1, 2, 3]), 10)),
					filename: "in.json",
				}],
				handleResult: data => Array.isArray(data) ? data.map(n => n * 2) : "got a promise, not data",
			},
			expect: [2, 4, 6],
		},
		{
			name: "Empty input",
			arg: { input: [] },
			expect: {},
		},
		{
			name: "Empty glob match",
			description:
				"#56 — a glob with no matches drops entirely, instead of leaking its parent File (whose contents are undefined).",
			arg: {
				resultType: "array",
				input: __dirname + "files/no-such-prefix-*",
			},
			expect: {},
		},
		{
			name: "resultType: args (default)",
			description:
				"#84 — the default shape spreads one argument per element; single-element input passes through bare, preserving the old default.",
			tests: [
				{
					name: "Multiple inputs spread as positional arguments",
					arg: {
						input: [
							{ contents: { a: 1 }, filename: "a.json" },
							{ contents: { b: 2 }, filename: "b.json" },
						],
						handleResult: (a, b) => ({ ...a, ...b }),
					},
					expect: { a: 1, b: 2 },
				},
				{
					name: "Without handleResult, multiple elements pass through as an array",
					arg: {
						input: [
							{ contents: "a", filename: "a.json" },
							{ contents: "b", filename: "b.json" },
						],
					},
					expect: ["a", "b"],
				},
			],
		},
		{
			name: "resultType: -grouped",
			description:
				"#84 — opt-in: one element per input descriptor, a glob contributing its matches as an array, so siblings keep positional identity regardless of how many files matched.",
			tests: [
				{
					name: "Glob groups; named sibling keeps its position",
					arg: {
						resultType: "array-grouped",
						input: [
							__dirname + "files/*.txt",
							{ contents: { meta: true }, filename: "meta.json" },
						],
						handleResult: ([texts, meta]) => ({
							matched: texts.length,
							meta,
						}),
					},
					expect: { matched: 2, meta: { meta: true } },
				},
				{
					name: "Grouped args spread with files",
					arg: {
						resultType: "args-grouped-files",
						input: [
							{ contents: { meta: true }, filename: "meta.json" },
							__dirname + "files/*.txt",
						],
						handleResult: (meta, texts) => [
							meta.filename,
							texts.map(f => f.contents.length > 0),
						],
					},
					expect: ["meta.json", [true, true]],
				},
				{
					name: "Grouped single glob without handleResult yields its contents array",
					arg: {
						resultType: "grouped",
						input: [__dirname + "files/greeting*.txt"],
					},
					expect: ["Hello, world!"],
				},
				{
					name: "Unmatched glob between siblings yields an empty array element",
					arg: {
						resultType: "array-grouped",
						input: [
							{ contents: "a", filename: "a.json" },
							__dirname + "files/no-such-prefix-*",
							{ contents: "b", filename: "b.json" },
						],
					},
					expect: ["a", [], "b"],
				},
				{
					name: "Ungrouped globs keep splicing matches inline",
					arg: {
						resultType: "array",
						input: [
							__dirname + "files/*.txt",
							{ contents: "meta", filename: "meta.json" },
						],
					},
					expect: [
						"Hello, world!",
						"These are some plain text notes.\nThey span multiple lines.\nThat's all.",
						"meta",
					],
				},
			],
		},
		{
			name: "resultType: object",
			description: "#84 — elements keyed by descriptor `id`, falling back to file name.",
			tests: [
				{
					name: "Keys by name, id overrides",
					arg: {
						resultType: "object",
						input: [
							{ contents: { a: 1 }, filename: "data.json" },
							{ contents: "notes", filename: "notes.txt", id: "meta" },
						],
					},
					expect: { data: { a: 1 }, meta: "notes" },
				},
				{
					name: "Grouped glob keys by its id",
					arg: {
						resultType: "object-grouped",
						input: [
							{ name: __dirname + "files/*.txt", id: "texts" },
							{ contents: { a: 1 }, filename: "data.json" },
						],
						handleResult: ({ texts, data }) => ({
							matched: texts.length,
							data,
						}),
					},
					expect: { matched: 2, data: { a: 1 } },
				},
				{
					name: "files: true composes with object",
					arg: {
						resultType: "object-files",
						input: [
							{ contents: { a: 1 }, filename: "data.json" },
							{ contents: "notes", filename: "notes.txt", id: "meta" },
						],
						handleResult: ({ data, meta }) => [data.filename, meta.contents],
					},
					expect: ["data.json", "notes"],
				},
				{
					name: "Ungrouped glob children key by name, not their family id",
					arg: {
						resultType: "object",
						input: [{ name: __dirname + "files/*.txt", id: "texts" }],
						handleResult: keys => Object.keys(keys).map(k => k.split("/").pop()),
					},
					expect: ["greeting", "notes"],
				},
				{
					name: "Glob children inherit their family id",
					arg: {
						resultType: "files",
						input: [{ name: __dirname + "files/*.txt", id: "texts" }],
						handleResult: files => files.map(f => f.id),
					},
					expect: ["texts", "texts"],
				},
				{
					name: "Grouped glob without an id keys by its pattern",
					arg: {
						resultType: "object-grouped",
						input: [__dirname + "files/*.txt"],
						handleResult: obj =>
							Object.keys(obj)[0] === __dirname + "files/*.txt",
					},
					expect: true,
				},
				{
					name: "Duplicate keys throw instead of silently dropping data",
					arg: {
						resultType: "object",
						input: [
							{ contents: { from: "first" }, filename: "data.json" },
							{ contents: { from: "second" }, filename: "notes.txt", id: "data" },
						],
					},
					throws: /Duplicate key "data"/,
				},
			],
		},
		{
			name: "resultType microsyntax",
			tests: [
				{
					name: "Tokens are order-insensitive",
					arg: {
						resultType: "files-array",
						input: [{ contents: { x: 1 }, filename: "x.json" }],
						handleResult: ([file]) => file.filename,
					},
					expect: "x.json",
				},
				{
					name: "Unknown token throws",
					arg: {
						resultType: "array-groupde",
						input: [{ contents: "a", filename: "a.json" }],
					},
					throws: /Invalid resultType token "groupde"/,
				},
				{
					name: "files without an explicit type implies array",
					description:
						"grouped-files ≡ array-grouped-files — the grouped version of legacy \"files\".",
					arg: {
						resultType: "grouped-files",
						input: [
							{ contents: "a", filename: "a.json" },
							{ contents: "b", filename: "b.json" },
						],
						handleResult: elements => elements.map(f => f.filename),
					},
					expect: ["a.json", "b.json"],
				},
				{
					name: "Two type tokens throw",
					arg: {
						resultType: "array-object",
						input: [{ contents: "a", filename: "a.json" }],
					},
					throws: /more than one type token/,
				},
			],
		},
		{
			name: "Dry run",
			description: "dryRun: true returns debug info without processing data",
			data: { full: true, dryRun: true },
			check: { subset: true, deep: true },
			tests: [
				{
					name: "Returns debug info, skips handleResult",
					arg: {
						input: [{ contents: { a: 1 }, filename: "in.json" }],
						handleResult () {
							throw new Error("should not run");
						},
					},
					expect: { type: "data" },
				},
				{
					name: "Reports the parsed, effective resultType",
					arg: {
						resultType: "array-grouped",
						input: [{ contents: { a: 1 }, filename: "in.json" }],
					},
					expect: { resultType: { type: "array", grouped: true, files: false } },
				},
				{
					name: "Surfaces a malformed resultType instead of echoing it",
					arg: {
						resultType: "arrray",
						input: [{ contents: { a: 1 }, filename: "in.json" }],
					},
					throws: /Invalid resultType token "arrray"/,
				},
			],
		},
		{
			name: "Multi-output",
			description: "Tasks with multiple output files (#27, #28)",
			data: { full: true },
			beforeAll () {
				this._write = File.prototype.write;
				// Skip disk I/O: return the payload length as a deterministic size.
				File.prototype.write = function (data) {
					return data.length;
				};
			},
			afterAll () {
				File.prototype.write = this._write;
			},
			check: { subset: true, deep: true },
			tests: [
				{
					name: "Single output mirrors singular props",
					arg: {
						input: [{ contents: "hello", filename: "in.json" }],
						output: "out.json",
					},
					expect: {
						outputPath: "out.json",
						size: 5,
						outputs: [{ outputPath: "out.json", size: 5 }],
					},
				},
				{
					name: "Per-file handleResult splits data",
					arg: {
						input: [{ contents: "hello", filename: "in.json" }],
						output: [
							{ filename: "upper.json", handleResult: r => r.toUpperCase() },
							{ filename: "exclaim.json", handleResult: r => r + "!" },
						],
					},
					expect: { outputs: [{ size: 5 }, { size: 6 }] },
				},
				{
					name: "Without per-file handleResult, gets main result",
					arg: {
						input: [{ contents: "hello", filename: "in.json" }],
						handleResult: r => r.toUpperCase(),
						output: [
							{ filename: "exclaim.json", handleResult: r => r + "!" },
							{ filename: "upper.json" },
						],
					},
					expect: { outputs: [{ size: 6 }, { size: 5 }] },
				},
				{
					name: "handleResult returning undefined falls back to main result",
					arg: {
						input: [{ contents: "yolo", filename: "in.json" }],
						handleResult: r => r + r,
						output: [{ filename: "doubled.json", handleResult: () => undefined }],
					},
					expect: { outputs: [{ size: 8 }] },
				},
				{
					name: "handleResult returning null skips that file",
					arg: {
						input: [{ contents: "hello", filename: "in.json" }],
						output: [
							{ filename: "keep.json" },
							{ filename: "skip.json", handleResult: () => null },
						],
					},
					expect: { outputs: [{ outputPath: "keep.json", size: 5 }] },
				},
				{
					name: "All outputs null → empty outputs array",
					description:
						"bin/qualve.js distinguishes this (outputs: []) from 'no outputs configured' so nothing is printed to stdout.",
					arg: {
						input: [{ contents: "hello", filename: "in.json" }],
						output: [
							{ filename: "first.json", handleResult: () => null },
							{ filename: "second.json", handleResult: () => null },
						],
					},
					expect: { outputs: [] },
				},
				{
					name: "Dynamic output resolves after runTask",
					arg: {
						input: [{ contents: "hello world", filename: "in.json" }],
						handleResult: r => r.split(" "),
						output: result =>
							result.map((word, i) => ({
								filename: `${word}.json`,
								handleResult: r => r[i],
							})),
					},
					expect: {
						outputs: [
							{ outputPath: "hello.json", size: 5 },
							{ outputPath: "world.json", size: 5 },
						],
					},
				},
				{
					name: "Dynamic output receives Task instance as this",
					description:
						"Regression guard: the function is invoked via .call(this, result).",
					arg: {
						title: "greeter",
						input: [{ contents: "hi", filename: "in.json" }],
						output () {
							return { filename: `${this.title}.json` };
						},
					},
					expect: { outputs: [{ outputPath: "greeter.json" }] },
				},
				{
					name: "Batching + multi-output throws",
					arg: {
						input: [
							{
								contents: [1, 2, 3, 4],
								filename: "nums.json",
								schema: { type: "array" },
							},
						],
						itemsPerPage: 2,
						output: [{ filename: "a.json" }, { filename: "b.json" }],
					},
					throws: e => /multiple or dynamic outputs/.test(e.message),
				},
				{
					name: "Batching + dynamic output throws",
					arg: {
						input: [
							{
								contents: [1, 2, 3, 4],
								filename: "nums.json",
								schema: { type: "array" },
							},
						],
						itemsPerPage: 2,
						output: () => ({ filename: "out.json" }),
					},
					throws: e => /multiple or dynamic outputs/.test(e.message),
				},
				{
					name: "Batching + single output creates subtasks",
					description:
						"Regression guard: a single output must NOT trigger the multi/dynamic-output check. Verifies the guard accepted the spec by checking subtask count.",
					async run (spec) {
						let task = Task.create(
							{ type: "data", title: "Test", ...spec },
							{ info: () => {} },
						);
						await task.ready;
						return task.computedSubtasks.length;
					},
					arg: {
						input: [
							{
								contents: [1, 2, 3, 4, 5],
								filename: "nums.json",
								schema: { type: "array" },
							},
						],
						itemsPerPage: 2,
						output: { filename: "out.json", schema: { type: "array" } },
					},
					expect: 3,
				},
			],
		},
		{
			name: "Dynamic input",
			async run (spec) {
				let task = Task.create(
					{ type: "data", title: "Test", ...spec },
					{ info: () => {} },
				);
				await task.ready;
				return (task.input ?? []).map(f => f.filename);
			},
			tests: [
				{
					name: "Resolves before runTask",
					arg: {
						input: () => ({ name: "in" }),
					},
					expect: ["in.json"],
				},
				{
					name: "Returns undefined → no input",
					description: "Mirrors a task that doesn't declare input.",
					arg: { input: () => undefined },
					expect: [],
				},
				{
					name: "this is bound to Task",
					arg: {
						title: "Dynamic input",
						input () {
							return { name: this.title };
						},
					},
					expect: ["Dynamic input.json"],
				},
				{
					name: "Errors propagate through ready",
					arg: {
						input: () => {
							throw new Error("input boom");
						},
					},
					throws: e => e.message === "input boom",
				},
				{
					name: "Subtask input resolution",
					async run (spec) {
						let task = Task.create(
							{ type: "data", title: "Test", ...spec },
							{ info: () => {} },
						);
						await task.ready;
						let subtask = task.computedSubtasks[0];
						await subtask.ready;
						return (subtask.input ?? []).map(f => f.filename);
					},
					tests: [
						{
							name: "Each child resolves against its own this",
							arg: {
								subtasks: [
									{
										type: "data",
										title: "Child",
										input () {
											return { name: `${this.parent.title}-${this.title}` };
										},
									},
								],
							},
							expect: ["Test-Child.json"],
						},
						{
							name: "Batching preserves non-batchable files",
							description:
								"Batchable entry becomes a slice descriptor; others pass through.",
							arg: {
								input: () => [
									{ name: "meta" },
									{
										contents: [1, 2, 3, 4, 5],
										name: "nums",
										schema: { type: "array" },
									},
								],
								itemsPerPage: 2,
								output: { name: "out", schema: { type: "array" } },
							},
							expect: ["meta.json", "nums-0-1.json"],
						},
					],
				},
			],
		},
		{
			name: "Function-valued input entries",
			description: "#81 — individual entries in an input array may be functions.",
			tests: [
				{
					name: "Resolves with task context",
					arg: {
						input: [
							function () {
								return { contents: this.title, filename: "t.json" };
							},
						],
					},
					expect: "Test",
				},
				{
					name: "Nullish return drops the entry",
					arg: {
						resultType: "array",
						input: [{ contents: "a", filename: "a.json" }, () => null],
					},
					expect: ["a"],
				},
				{
					name: "Array return splices in place",
					arg: {
						resultType: "array",
						input: [
							() => [
								{ contents: 1, filename: "a.json" },
								{ contents: 2, filename: "b.json" },
							],
							{ contents: 3, filename: "c.json" },
						],
					},
					expect: [1, 2, 3],
				},
			],
		},
		{
			name: "Optional input",
			tests: [
				{
					name: "Absent optional file is filtered out",
					arg: {
						input: [
							{ contents: { a: 1 }, filename: "kept.json" },
							{ filename: __dirname + "files/does-not-exist.json", optional: true },
						],
					},
					expect: { a: 1 },
				},
				{
					name: "Present optional file is kept",
					arg: {
						input: [{ filename: __dirname + "files/greeting.txt", optional: true }],
					},
					expect: "Hello, world!",
				},
				{
					name: "Required absent files surface read errors",
					description:
						"Without optional, missing files stay in input and fail loudly at read time — the contract is no silent skipping.",
					arg: {
						input: [{ filename: __dirname + "files/does-not-exist.json" }],
					},
					throws: e => e.code === "ENOENT",
				},
			],
		},
	],
};
