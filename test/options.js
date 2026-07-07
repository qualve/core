import availableOptions, {
	findValue,
	resolveValue,
	resolveOptions,
	mergeSchemas,
	assembleOptions,
} from "../src/options.js";
import Task from "../src/task.js";

export default {
	name: "Options chain",
	tests: [
		{
			name: "findValue",
			run: ({ bag, key, option }) => findValue(bag, key, option ?? {}),
			tests: [
				{
					name: "Canonical key",
					arg: { bag: { foo: 1 }, key: "foo" },
					expect: ["foo", 1],
				},
				{
					name: "Long alias",
					arg: {
						bag: { "items-per-page": 50 },
						key: "itemsPerPage",
						option: { long: "items-per-page" },
					},
					expect: ["items-per-page", 50],
				},
				{
					name: "Short alias",
					arg: { bag: { p: 50 }, key: "itemsPerPage", option: { short: "p" } },
					expect: ["p", 50],
				},
				{
					name: "Auto kebab fallback",
					arg: { bag: { "my-flag": true }, key: "myFlag" },
					expect: ["my-flag", true],
				},
				{
					name: "Not found",
					arg: { bag: { other: 1 }, key: "missing" },
					expect: [null, undefined],
				},
			],
		},
		{
			name: "resolveValue",
			tests: [
				{
					name: "Function passes through unchanged",
					run: () => {
						let fn = () => "deferred";
						let resolved = resolveValue({ key: "x" }, fn);
						return resolved === fn;
					},
					expect: true,
				},
				{
					name: "parse: Number coerces string",
					run: () => resolveValue({ key: "n", parse: Number }, "42"),
					expect: 42,
				},
				{
					name: "parse: Number throws on NaN",
					run: () => resolveValue({ key: "n", parse: Number }, "abc"),
					throws: true,
				},
				{
					name: "parse runs on non-string values",
					run: () => resolveValue({ key: "x", parse: v => v.length }, ["a", "b"]),
					expect: 2,
				},
				{
					name: "tasks: shorthands normalize, default exclude is a predicate, user excludes array-ify",
					run: () => {
						let option = availableOptions.tasks;
						// The default exclude is a Dirent predicate (not a glob), so represent it
						// by its verdict on a `_`-name vs a plain name; user excludes stay arrays.
						let describe = t => ({
							include: t.include,
							exclude:
								typeof t.exclude === "function"
									? { _x: t.exclude({ name: "_x" }), x: t.exclude({ name: "x" }) }
									: t.exclude,
						});
						return [
							describe(resolveValue(option, "pipelines/**/*.js")),
							describe(resolveValue(option, { include: "pipelines/**/*.js" })),
							describe(resolveValue(option, { include: "a/*.js", exclude: [] })),
						];
					},
					expect: [
						{ include: "pipelines/**/*.js", exclude: { _x: true, x: false } },
						{ include: "pipelines/**/*.js", exclude: { _x: true, x: false } },
						{ include: "a/*.js", exclude: [] },
					],
				},
				{
					// A user may supply their own Dirent predicate; it must pass through, not
					// get array-ified into a glob list.
					name: "tasks: a user-supplied exclude predicate passes through unchanged",
					run: () => {
						let mine = entry => entry.name === "skip.js";
						return (
							resolveValue(availableOptions.tasks, { include: "a/*.js", exclude: mine })
								.exclude === mine
						);
					},
					expect: true,
				},
				{
					name: "values: array accepts member",
					run: () => resolveValue({ key: "x", values: ["a", "b"] }, "a"),
					expect: "a",
				},
				{
					name: "values: array throws on non-member",
					run: () => resolveValue({ key: "x", values: ["a", "b"] }, "c"),
					throws: true,
				},
				{
					name: "values: regex accepts match",
					run: () => resolveValue({ key: "x", values: /^[a-z]+$/ }, "hello"),
					expect: "hello",
				},
				{
					name: "values: regex throws on mismatch",
					run: () => resolveValue({ key: "x", values: /^[a-z]+$/ }, "Hello123"),
					throws: true,
				},
				{
					name: "validate: false throws",
					run: () => resolveValue({ key: "x", validate: v => v > 0 }, -1),
					throws: true,
				},
				{
					name: "validate: true returns value",
					run: () => resolveValue({ key: "x", validate: v => v > 0 }, 5),
					expect: 5,
				},
				{
					name: "validate: suggestion array surfaces in error message",
					run: () => {
						try {
							resolveValue(
								{ key: "x", long: "thing", validate: () => ["foo", "bar"] },
								"fo",
							);
							return null;
						}
						catch (e) {
							return e.message;
						}
					},
					expect: `Invalid value for --thing: "fo". Did you mean: foo, bar?`,
				},
				{
					name: "validate: empty suggestion array treated as false",
					run: () => resolveValue({ key: "x", validate: () => [] }, "anything"),
					throws: true,
				},
				{
					name: "parse runs on any defined value",
					// `Number(true) === 1` — parse is normalization, not just string coercion
					run: () => resolveValue({ key: "n", parse: Number }, true),
					expect: 1,
				},
			],
		},
		{
			name: "resolveOptions",
			run: ({ schema, input, taskFields }) => resolveOptions(schema, input, taskFields),
			tests: [
				{
					name: "External value wins over task field and default",
					arg: {
						schema: { x: { default: "fallback" } },
						input: { x: "external" },
						taskFields: { x: "from-task" },
					},
					expect: { resolved: { x: "external" }, claimed: new Set(["x"]) },
				},
				{
					name: "Task field used when no external value",
					arg: {
						schema: { x: { default: "fallback" } },
						input: {},
						taskFields: { x: "from-task" },
					},
					expect: { resolved: { x: "from-task" }, claimed: new Set() },
				},
				{
					name: "Default when neither external nor task-def has key",
					arg: {
						schema: { x: { default: "fallback" } },
						input: {},
						taskFields: {},
					},
					expect: { resolved: { x: "fallback" }, claimed: new Set() },
				},
				{
					name: "No default, no input, no task-def → omitted",
					arg: {
						schema: { x: { description: "no default" } },
						input: {},
						taskFields: {},
					},
					expect: { resolved: {}, claimed: new Set() },
				},
				{
					name: "Alias claim records the alias key",
					arg: {
						schema: { itemsPerPage: { long: "items-per-page", short: "p" } },
						input: { p: 50 },
						taskFields: {},
					},
					expect: { resolved: { itemsPerPage: 50 }, claimed: new Set(["p"]) },
				},
				{
					name: "Function default called eagerly",
					arg: {
						schema: { x: { default: () => 42 } },
						input: {},
						taskFields: {},
					},
					expect: { resolved: { x: 42 }, claimed: new Set() },
				},
				{
					name: "Function default reads another option through `this`",
					arg: {
						schema: {
							a: { default: 2 },
							b: {
								default () {
									return this.a * 3;
								},
							},
						},
						input: {},
						taskFields: {},
					},
					expect: { resolved: { a: 2, b: 6 }, claimed: new Set() },
				},
				{
					name: "Order-independent: dependent declared before dependency",
					arg: {
						schema: {
							b: {
								default () {
									return this.a * 3;
								},
							},
							a: { default: 2 },
						},
						input: {},
						taskFields: {},
					},
					expect: { resolved: { b: 6, a: 2 }, claimed: new Set() },
				},
				{
					name: "External value wins over function default",
					arg: {
						schema: {
							a: { default: 1 },
							b: {
								default () {
									return this.a * 100;
								},
							},
						},
						input: { b: 7 },
						taskFields: {},
					},
					expect: { resolved: { a: 1, b: 7 }, claimed: new Set(["b"]) },
				},
				{
					name: "Cycle detected and thrown",
					run: () =>
						resolveOptions({
							a: {
								default () {
									return this.b;
								},
							},
							b: {
								default () {
									return this.a;
								},
							},
						}),
					throws: /Cycle/,
				},
				{
					name: "Default returns undefined → consumers see undefined, no throw",
					arg: {
						schema: { a: { default: () => undefined } },
						input: {},
						taskFields: {},
					},
					expect: { resolved: { a: undefined }, claimed: new Set() },
				},
				{
					name: "Default reads option claimed by external input",
					arg: {
						schema: {
							a: { default: "fallback" },
							b: {
								default () {
									return this.a + "-suffix";
								},
							},
						},
						input: { a: "external" },
						taskFields: {},
					},
					expect: {
						resolved: { a: "external", b: "external-suffix" },
						claimed: new Set(["a"]),
					},
				},
				{
					name: "Default runs through validate (tightening: was author-asserted)",
					run: () =>
						resolveOptions({
							x: { default: -1, validate: v => v > 0 },
						}),
					throws: true,
				},
				{
					name: "Default reads option with no default → undefined",
					arg: {
						schema: {
							a: { description: "no default" },
							b: {
								default () {
									return this.a ?? "fallback";
								},
							},
						},
						input: {},
						taskFields: {},
					},
					expect: { resolved: { b: "fallback" }, claimed: new Set() },
				},
				{
					name: "present: true with no value throws",
					run: () => resolveOptions({ x: { long: "x", present: true } }),
					throws: /Required option missing: --x/,
				},
				{
					name: "present: true with value passes",
					arg: { schema: { x: { present: true } }, input: { x: "v" } },
					expect: { resolved: { x: "v" }, claimed: new Set(["x"]) },
				},
				{
					name: "present: function returning true throws if no value",
					run: () =>
						resolveOptions({
							scope: { default: "question" },
							question: {
								long: "question",
								present () {
									return this.scope === "question";
								},
							},
						}),
					throws: /Required option missing: --question/,
				},
				{
					name: "present: function returning undefined leaves option optional",
					arg: {
						schema: {
							scope: { default: "survey" },
							question: {
								present () {
									if (this.scope === "question") {
										return true;
									}
									// Undefined for any other scope → optional.
								},
							},
						},
						input: {},
						taskFields: {},
					},
					expect: { resolved: { scope: "survey" }, claimed: new Set() },
				},
				{
					name: "present: false with external value is not rejected — skipped and claimed",
					arg: {
						schema: { x: { long: "x", present: false } },
						input: { x: "v" },
						taskFields: {},
					},
					expect: { resolved: {}, claimed: new Set(["x"]) },
				},
				{
					name: "present: false with no value skips default",
					arg: {
						schema: { x: { present: false, default: "fallback" } },
						input: {},
						taskFields: {},
					},
					expect: { resolved: {}, claimed: new Set() },
				},
				{
					name: "present: function returning false (not applicable) skips and claims the value",
					arg: {
						schema: {
							scope: { default: "survey" },
							question: {
								long: "question",
								present () {
									return this.scope === "question" ? true : false;
								},
							},
						},
						input: { question: "react" },
						taskFields: {},
					},
					expect: { resolved: { scope: "survey" }, claimed: new Set(["question"]) },
				},
				{
					name: "present: undefined (absent field) is optional, no errors",
					arg: {
						schema: { x: {} },
						input: {},
						taskFields: {},
					},
					expect: { resolved: {}, claimed: new Set() },
				},
				{
					name: "default returning undefined satisfies present: true",
					arg: {
						schema: { x: { present: true, default: () => undefined } },
						input: {},
						taskFields: {},
					},
					expect: { resolved: { x: undefined }, claimed: new Set() },
				},
			],
		},
		{
			name: "mergeSchemas",
			run: ({ parent, child }) => mergeSchemas(parent, child),
			tests: [
				{
					name: "Child adds new key",
					arg: { parent: { x: { default: 1 } }, child: { y: { default: 2 } } },
					expect: { x: { default: 1 }, y: { default: 2 } },
				},
				{
					name: "Child wins per field on overlap",
					run: () => {
						let parent = { x: { description: "p", default: 1 } };
						let child = { x: { default: 2, validate: v => v > 0 } };
						let merged = mergeSchemas(parent, child);
						return (
							merged.x.description === "p" &&
							merged.x.default === 2 &&
							typeof merged.x.validate === "function"
						);
					},
					expect: true,
				},
			],
		},
		{
			name: "assembleOptions",
			tests: [
				{
					name: "Empty call returns empty schema",
					run: () => Object.keys(assembleOptions()).length,
					expect: 0,
				},
				{
					name: "Single schema passes through",
					run: () => {
						let s = assembleOptions({ x: { default: 1 } });
						return s.x?.default === 1;
					},
					expect: true,
				},
				{
					name: "Schemas merge in order, later winning per field",
					run: () => {
						let a = { x: { description: "a", default: 1 } };
						let b = { x: { default: 2 } };
						let s = assembleOptions(a, b);
						return s.x.description === "a" && s.x.default === 2;
					},
					expect: true,
				},
				{
					name: "Variadic with null/undefined entries skipped",
					run: () => {
						let s = assembleOptions(
							{ a: { default: 1 } },
							null,
							{ b: { default: 2 } },
							undefined,
						);
						return s.a?.default === 1 && s.b?.default === 2;
					},
					expect: true,
				},
			],
		},
		{
			name: "Task.aggregateSchema",
			run: ({ taskDef }) => Object.keys(Task.aggregateSchema(taskDef)).sort(),
			tests: [
				{
					name: "Leaf task: own options only",
					arg: { taskDef: { options: { foo: {}, bar: {} } } },
					expect: ["bar", "foo"],
				},
				{
					name: "Compound: subtask options surfaced on parent",
					arg: {
						taskDef: {
							options: { parentOpt: {} },
							subtasks: [
								{ options: { childOpt: {} } },
								{ options: { otherOpt: {} } },
							],
						},
					},
					expect: ["childOpt", "otherOpt", "parentOpt"],
				},
				{
					name: "Nested compounds recurse",
					arg: {
						taskDef: {
							subtasks: [{ subtasks: [{ options: { deep: {} } }] }],
						},
					},
					expect: ["deep"],
				},
				{
					name: "Conflict: later sibling subtask wins per field",
					run: () => {
						let s = Task.aggregateSchema({
							subtasks: [
								{ options: { x: { description: "first", default: 1 } } },
								{ options: { x: { default: 2 } } },
							],
						});
						return s.x.description === "first" && s.x.default === 2;
					},
					expect: true,
				},
				{
					name: "Conflict: parent options win over subtask options",
					run: () => {
						let s = Task.aggregateSchema({
							options: { x: { description: "parent" } },
							subtasks: [{ options: { x: { description: "child" } } }],
						});
						return s.x.description;
					},
					expect: "parent",
				},
			],
		},
		{
			name: "Compound resolution: subtask-only options don't run predicates against the parent",
			description:
				"A subtask declaring an option with a scope-conditional `present` predicate " +
				"should not have that predicate evaluated against the parent. The parent surfaces " +
				"the option via optionsSchema (for CLI parse / --help) but only resolves against " +
				"consumedSchema (its own declarations). Without this split, a present predicate " +
				"like `this.scope === 'leaf'` would return false on a scope-less parent and " +
				"incorrectly reject user input meant for the subtask.",
			tests: [
				{
					name: "Subtask option is in aggregated optionsSchema but not consumedSchema",
					run: () => {
						let t = Task.create(
							{
								subtasks: [
									{
										type: "data",
										mode: "leaf",
										// Subtask declares both scope (so its predicate can read it
										// via the Proxy) and x (whose presence depends on scope).
										options: {
											mode: {},
											x: {
												present () {
													return this.mode === "leaf";
												},
											},
										},
										input: [{ contents: {}, filename: "s.json" }],
									},
								],
							},
							{ info: () => {}, options: { x: "value" } },
						);
						return {
							optionsHasX: "x" in t.optionsSchema,
							consumedHasX: "x" in t.consumedSchema,
							parentX: t.x,
							subtaskX: t.subtasks[0].x,
						};
					},
					// Parent doesn't claim x through resolveOptions (it's not in
					// consumedSchema), but the unknown-options escape hatch still
					// surfaces the value on the instance. The key win: parent's
					// present predicate is never evaluated. Value rides down to the
					// subtask via rawOptions inheritance; subtask resolves it.
					expect: {
						optionsHasX: true,
						consumedHasX: false,
						parentX: "value",
						subtaskX: "value",
					},
				},
				{
					name: "Subtask-declared fan-out driver fans out at the subtask, not the parent",
					description:
						"A subtask declaring `{multiple: true, present: true}` for an option the " +
						"parent doesn't own should drive fan-out at the subtask layer only. The " +
						"parent's `optionsSchema` surfaces the option (so --help and CLI parse " +
						"see it), but findFanoutDriver iterates `consumedSchema`, so the parent " +
						"doesn't fan out on something it doesn't own.",
					run: () => {
						let parent = Task.create(
							{
								subtasks: [
									{
										type: "data",
										options: { x: { multiple: true, present: true } },
										input: [{ contents: {}, filename: "s.json" }],
									},
								],
							},
							{ info: () => {}, options: { x: ["a", "b"] } },
						);
						return {
							parentFanout: parent.computedSubtasks.length,
							subtaskFanout: parent.subtasks[0].computedSubtasks.length,
						};
					},
					expect: { parentFanout: 1, subtaskFanout: 2 },
				},
			],
		},
		{
			name: "Task option resolution in constructor",
			run: ({ task, options }) => {
				let t = Task.create(task, { info: () => {}, options });
				return {
					detail: t.detail,
					unknown: t.unknownOptions,
				};
			},
			tests: [
				{
					name: "Declared option becomes direct instance property",
					arg: {
						task: {
							type: "data",
							options: {
								detail: { default: "summary", values: ["summary", "full"] },
							},
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: { detail: "full" },
					},
					check: { subset: true, deep: true },
					expect: { detail: "full" },
				},
				{
					name: "Default applied when external value missing",
					arg: {
						task: {
							type: "data",
							options: { detail: { default: "summary" } },
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: {},
					},
					check: { subset: true, deep: true },
					expect: { detail: "summary" },
				},
				{
					name: "Unknown option lands in unknownOptions bag",
					arg: {
						task: {
							type: "data",
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: { mystery: "value" },
					},
					check: { subset: true, deep: true },
					expect: { unknown: { mystery: "value" } },
				},
				{
					name: "values mismatch throws",
					arg: {
						task: {
							type: "data",
							options: { detail: { values: ["a", "b"] } },
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: { detail: "z" },
					},
					throws: true,
				},
				{
					name: "Function value passes through to instance unchanged",
					run: ({ task, options }) => {
						let t = Task.create(task, { info: () => {}, options });
						return typeof t.detail === "function";
					},
					arg: {
						task: {
							type: "data",
							options: { detail: { default: "summary" } },
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: { detail: () => "deferred" },
					},
					expect: true,
				},
			],
		},
		{
			name: "Task-declared positional options",
			run: ({ task, options }) => {
				let t = Task.create(task, { info: () => {}, options });
				return t.feature;
			},
			tests: [
				{
					name: "Positional value from `_` is matched into the option",
					arg: {
						task: {
							type: "data",
							options: { feature: { positional: 0 } },
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: { _: ["my-feature"] },
					},
					expect: "my-feature",
				},
				{
					name: "Sibling tasks with different positional schemas resolve independently",
					run: ({ taskA, taskB, options }) => {
						let a = Task.create(taskA, { info: () => {}, options });
						let b = Task.create(taskB, { info: () => {}, options });
						return [a.featureA, b.featureB];
					},
					arg: {
						taskA: {
							type: "data",
							options: { featureA: { positional: 0 } },
							input: [{ contents: {}, filename: "a.json" }],
						},
						taskB: {
							type: "data",
							options: { featureB: { positional: 0 } },
							input: [{ contents: {}, filename: "b.json" }],
						},
						options: { _: ["x"] },
					},
					expect: ["x", "x"],
				},
			],
		},
		{
			name: "Task-def field as per-task default",
			run: ({ task, options }) => {
				let t = Task.create(task, { info: () => {}, options });
				return t.detail;
			},
			tests: [
				{
					name: "Task-def field overrides static default",
					arg: {
						task: {
							type: "data",
							detail: "from-task",
							options: { detail: { default: "static" } },
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: {},
					},
					expect: "from-task",
				},
				{
					name: "External value overrides task-def field",
					arg: {
						task: {
							type: "data",
							detail: "from-task",
							options: { detail: { default: "static" } },
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: { detail: "external" },
					},
					expect: "external",
				},
			],
		},
		{
			name: "resolveOption helper",
			run: ({ task, options }) => {
				let t = Task.create(task, { info: () => {}, options });
				return t.resolveOption("detail");
			},
			tests: [
				{
					name: "Calls function values",
					arg: {
						task: {
							type: "data",
							options: { detail: { default: "x" } },
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: {
							detail: function () {
								return "called";
							},
						},
					},
					expect: "called",
				},
				{
					name: "Returns scalar values as-is",
					arg: {
						task: {
							type: "data",
							options: { detail: { default: "x" } },
							input: [{ contents: {}, filename: "t.json" }],
						},
						options: { detail: "scalar" },
					},
					expect: "scalar",
				},
			],
		},
	],
};
