import { Task } from "../src/index.js";
import File from "../src/file.js";

const __dirname = new URL(".", import.meta.url).pathname;

export default {
	name: "DataTask",
	/**
	 * Shared run: create a DataTask from a spec and execute it.
	 * Returns the full result when `this.data.full` is set, otherwise just the processed result.
	 */
	async run (spec) {
		let task = Task.create({ type: "data", title: "Test", ...spec }, { info: () => {} });
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
			name: "Multi-output",
			description:
				"Tasks with multiple output files (see https://github.com/qualve/core/issues/27, https://github.com/qualve/core/issues/28)",
			data: { full: true },
			beforeAll () {
				/** Patch File.write to skip disk I/O — tests verify via return values only. */
				this._originalWrite = File.prototype.write;
				File.prototype.write = function (data) {
					return data.length;
				};
			},
			afterAll () {
				File.prototype.write = this._originalWrite;
			},
			check: { subset: true, deep: true },
			tests: [
				{
					name: "String as output",
					arg: {
						input: [{ contents: "hello", filename: "in.json" }],
						output: "foo",
					},
					expect: { outputs: [{ outputPath: "foo.json", size: 5 }] },
				},
				{
					name: "Object as output",
					arg: {
						input: [{ contents: "hi", filename: "in.json" }],
						output: { name: "bar" },
					},
					expect: { outputs: [{ outputPath: "bar.json", size: 2 }] },
				},
				{
					name: "Per-file handleResult transforms source data",
					arg: {
						input: [{ contents: "hello", filename: "in.json" }],
						output: [
							{ filename: "a.json", handleResult: r => r.toUpperCase() },
							{ filename: "b.json", handleResult: r => r + "!" },
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
							{ filename: "a.json", handleResult: r => r + "!" },
							{ filename: "b.json" },
						],
					},
					expect: { outputs: [{ size: 6 }, { size: 5 }] },
				},
				{
					name: "Dynamic output from function",
					arg: {
						input: [{ contents: "hello baz", filename: "in.json" }],
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
							{ outputPath: "baz.json", size: 3 },
						],
					},
				},
				{
					name: "handleResult returning undefined falls back to main result",
					arg: {
						input: [{ contents: "yolo", filename: "in.json" }],
						handleResult: r => r + r,
						output: [{ filename: "a.json", handleResult: () => undefined }],
					},
					expect: { outputs: [{ size: 8 }] },
				},
			],
		},
	],
};
