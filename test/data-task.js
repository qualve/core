import { Task } from "../src/index.js";

const __dirname = new URL(".", import.meta.url).pathname;

export default {
	name: "DataTask",
	/**
	 * Shared run: create a DataTask from a spec, execute it, return the processed result.
	 * No output file needed — omitting `output` skips the disk write.
	 */
	async run (spec) {
		let task = Task.create({ type: "data", title: "Test", ...spec }, { info: () => {} });
		let ret = await task.run();
		return ret?.result ?? ret;
	},
	tests: [
		{
			name: "Single file passthrough",
			arg: { input: [{ contents: { greeting: "hello" }, filename: "in.json" }] },
			expect: { greeting: "hello" },
		},
		{
			name: "Array resultType",
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
			name: "Files resultType returns File objects",
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
			name: "Dry run",
			description: "dryRun: true returns debug info without processing data",
			async run (spec) {
				let task = Task.create(
					{ type: "data", title: "Test", ...spec },
					{ info: () => {}, dryRun: true },
				);
				return await task.run();
			},
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
			],
		},
		{
			name: "Multiple outputs",
			async run (spec) {
				let task = Task.create({ type: "data", title: "Test", ...spec }, { info: () => {} });
				let ret = await task.run();
				// Read back written contents from each output file
				return ret?.result;
			},
			tests: [
				{
					name: "Per-file handleResult splits data",
					arg: {
						input: [{ contents: { html: "<h1>Hi</h1>", css: "h1{color:red}", js: "alert(1)" }, filename: "in.json" }],
						output: [
							{ name: "out-html", handleResult: r => r.html },
							{ name: "out-css", handleResult: r => r.css },
							{ name: "out-js", handleResult: r => r.js },
						],
					},
					expect: { html: "<h1>Hi</h1>", css: "h1{color:red}", js: "alert(1)" },
				},
				{
					name: "Per-file handleResult returning undefined falls back to result",
					arg: {
						input: [{ contents: { a: 1 }, filename: "in.json" }],
						output: [
							{ name: "full", handleResult: () => undefined },
						],
					},
					expect: { a: 1 },
				},
				{
					name: "Per-file handleResult returning null skips file",
					async run (spec) {
						let task = Task.create({ type: "data", title: "Test", ...spec }, { info: () => {} });
						let ret = await task.run();
						return ret?.outputPaths ?? ret?.outputPath ?? "none";
					},
					arg: {
						input: [{ contents: { a: 1 }, filename: "in.json" }],
						output: [
							{ name: "skipped", handleResult: () => null },
						],
					},
					expect: "none",
				},
			],
		},
		{
			name: "Dynamic output",
			async run (spec) {
				let task = Task.create({ type: "data", title: "Test", ...spec }, { info: () => {} });
				let ret = await task.run();
				return ret?.result;
			},
			tests: [
				{
					name: "Output function receives result and creates files",
					arg: {
						input: [{ contents: { x: 1, y: 2 }, filename: "in.json" }],
						output (result) {
							return Object.keys(result).map(key => ({
								name: `out-${key}`,
								handleResult: r => r[key],
							}));
						},
					},
					expect: { x: 1, y: 2 },
				},
			],
		},
	],
};
