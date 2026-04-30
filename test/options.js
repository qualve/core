import {
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
					arg: { bag: { "items-per-page": 50 }, key: "itemsPerPage", option: { long: "items-per-page" } },
					expect: ["items-per-page", 50],
				},
				{
					name: "Short alias",
					arg: { bag: { pp: 50 }, key: "itemsPerPage", option: { short: "pp" } },
					expect: ["pp", 50],
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
					name: "parse skipped on non-string",
					run: () => resolveValue({ key: "n", parse: Number }, 42),
					expect: 42,
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
						schema: { itemsPerPage: { long: "items-per-page", short: "pp" } },
						input: { pp: 50 },
						taskFields: {},
					},
					expect: { resolved: { itemsPerPage: 50 }, claimed: new Set(["pp"]) },
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
							merged.x.description === "p"
							&& merged.x.default === 2
							&& typeof merged.x.validate === "function"
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
						let s = assembleOptions({ a: { default: 1 } }, null, { b: { default: 2 } }, undefined);
						return s.a?.default === 1 && s.b?.default === 2;
					},
					expect: true,
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
							options: { detail: { default: "summary", values: ["summary", "full"] } },
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
						options: { detail: function () { return "called"; } },
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
