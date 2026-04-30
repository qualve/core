import ArgsReader from "../bin/util/args.js";

/**
 * Helper: create an ArgsReader, run positional matching against the schema, and return args.
 */
function parse (argv, options) {
	let r = new ArgsReader(argv);
	r.canonicalize(options);
	r.matchPositionals(options);
	return r.args;
}

export default {
	name: "ArgsReader",
	tests: [
		{
			name: "Positional matching",
			run: ({ argv, options }) => parse(argv, options),
			tests: [
				{
					name: "Single positional: true matches first _",
					arg: {
						argv: ["my-task"],
						options: { taskId: { long: "task", positional: true } },
					},
					expect: { taskId: "my-task", _: [] },
				},
				{
					name: "Multiple positional options matched in order",
					arg: {
						argv: ["hello", "world"],
						options: {
							first: { positional: true },
							second: { positional: 1 },
						},
					},
					expect: { first: "hello", second: "world", _: [] },
				},
				{
					name: "Numeric positional controls sort order",
					arg: {
						argv: ["aaa", "bbb"],
						options: {
							second: { positional: 2 },
							first: { positional: 1 },
						},
					},
					expect: { first: "aaa", second: "bbb", _: [] },
				},
				{
					name: "Flag takes precedence, positional skipped",
					arg: {
						argv: ["--task", "flagged", "positional-value"],
						options: {
							taskId: { long: "task", positional: true },
							other: { positional: 1 },
						},
					},
					expect: { taskId: "flagged", other: "positional-value", _: [] },
				},
				{
					name: "Short flag takes precedence",
					arg: {
						argv: ["-t", "flagged", "positional-value"],
						options: {
							taskId: { long: "task", short: "t", positional: true },
							other: { positional: 1 },
						},
					},
					expect: { taskId: "flagged", other: "positional-value", _: [] },
				},
				{
					name: "Unmatched positionals stay in _",
					arg: {
						argv: ["matched", "extra1", "extra2"],
						options: { first: { positional: true } },
					},
					expect: { first: "matched", _: ["extra1", "extra2"] },
				},
				{
					name: "No positional args leaves options undefined",
					arg: {
						argv: [],
						options: { taskId: { long: "task", positional: true } },
					},
					expect: { _: [] },
				},
			],
		},
		{
			name: "Multiple (rest) positional",
			run: ({ argv, options }) => parse(argv, options),
			tests: [
				{
					name: "multiple: true consumes all remaining",
					arg: {
						argv: ["a", "b", "c"],
						options: { items: { positional: true, multiple: true } },
					},
					expect: { items: ["a", "b", "c"], _: [] },
				},
				{
					name: "multiple: true with preceding positional",
					arg: {
						argv: ["my-task", "a", "b", "c"],
						options: {
							taskId: { long: "task", positional: true },
							items: { positional: 1, multiple: true },
						},
					},
					expect: { taskId: "my-task", items: ["a", "b", "c"], _: [] },
				},
				{
					name: "multiple: true with trailing positional reserves slots",
					arg: {
						argv: ["a", "b", "c", "last"],
						options: {
							items: { positional: true, multiple: true },
							trailing: { positional: 1 },
						},
					},
					expect: { items: ["a", "b", "c"], trailing: "last", _: [] },
				},
				{
					name: "multiple: true with no values leaves option unset",
					arg: {
						argv: [],
						options: { items: { positional: true, multiple: true } },
					},
					expect: { _: [] },
				},
				{
					name: "multiple: true skipped when flag provided",
					arg: {
						argv: ["--items", "flagged", "positional-value"],
						options: {
							items: { positional: true, multiple: true },
							other: { positional: 1 },
						},
					},
					expect: { items: "flagged", other: "positional-value", _: [] },
				},
				{
					name: "Two multiple: true options splits between them",
					arg: {
						argv: ["a", "b"],
						options: {
							first: { positional: true, multiple: true },
							second: { positional: 1, multiple: true },
						},
					},
					expect: { first: ["a"], second: ["b"], _: [] },
				},
			],
		},
	],
};
