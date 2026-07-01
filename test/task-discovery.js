import { Task } from "../src/index.js";
import Config from "../src/config.js";

const FIXTURES = "test/fixtures/task-discovery";
// Shared instance so resolve's pass-through can be checked by identity (=== at leaf).
const inlineDef = { type: "data" };

export default {
	name: "Task discovery",
	tests: [
		{
			name: "Task.ids",
			// ids come back in glob order; sort for an order-independent set comparison.
			run: tasks => Task.ids(new Config({ tasks })).sort(),
			tests: [
				{
					name: "Deep, skipping _-files and _-dirs (bare-dir shorthand)",
					arg: `${FIXTURES}/main`,
					expect: ["codes/update", "update"],
				},
				{
					name: "Explicit globs also skip _-files and _-dirs (framework convention)",
					arg: `${FIXTURES}/main/**/*.js`,
					expect: ["codes/update", "update"],
				},
				{
					name: "A _-dir named as the root is honored (skip applies only to discovered segments)",
					arg: `${FIXTURES}/main/_shared`,
					expect: ["helper"],
				},
				{
					name: "Overlapping globs are deduped by path",
					description: "update & codes/update match both globs but appear once.",
					arg: [`${FIXTURES}/main`, `${FIXTURES}/main/**/*.js`],
					expect: ["codes/update", "update"],
				},
				{
					name: "Empty spec discovers nothing (not a filesystem-root glob)",
					arg: "",
					expect: [],
				},
			],
		},
		{
			name: "Task.match",
			// sort ids for an order-independent set comparison.
			run: ({ tasks, query }) =>
				Task.match(query, new Config({ tasks }))
					.map(e => e.taskId)
					.sort(),
			tests: [
				{
					name: "Exact id wins over a basename collision",
					arg: { tasks: `${FIXTURES}/main`, query: "update" },
					expect: ["update"],
				},
				{
					name: "Basename collision returns every match",
					arg: { tasks: `${FIXTURES}/collision`, query: "update" },
					expect: ["codes/update", "features/update"],
				},
			],
		},
		{
			name: "Task.resolve",
			tests: [
				{
					name: "Single match loads the def with its id stamped",
					run: async () =>
						(await Task.resolve("update", new Config({ tasks: `${FIXTURES}/main` })))
							.id,
					expect: "update",
				},
				{
					name: "Basename collision builds an on-the-fly compound",
					async run () {
						let def = await Task.resolve(
							"update",
							new Config({ tasks: `${FIXTURES}/collision` }),
						);
						return { title: def.title, ids: def.subtasks.map(s => s.id).sort() };
					},
					expect: {
						title: "update (2 matches)",
						ids: ["codes/update", "features/update"],
					},
				},
				{
					name: "Inline task definition passes through unchanged",
					run: () => Task.resolve(inlineDef, new Config({})),
					expect: inlineDef,
				},
				{
					name: "Unknown id throws",
					run: () => Task.resolve("nope", new Config({ tasks: `${FIXTURES}/main` })),
					throws: true,
				},
			],
		},
		{
			name: "Task.load",
			tests: [
				{
					name: "Resolves a specific entry among same-id matches (by source, not id)",
					async run () {
						let config = new Config({
							tasks: [`${FIXTURES}/roots/a`, `${FIXTURES}/roots/b`],
						});
						let hits = Task.match("deploy", config);
						return { count: hits.length, second: (await Task.load(hits[1])).root };
					},
					expect: { count: 2, second: "b" },
				},
			],
		},
	],
};
