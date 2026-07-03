import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveTask, taskId } from "../src/task-discovery.js";
import Task from "../src/task.js";
import Config from "../src/config.js";

// Doubles as the fixture manifest: beforeAll generates the tree, afterAll removes it.
// resolveTask and taskId are pure over strings, so most tests never touch the disk.
const PATHS = [
	"answers-normalize.js",
	"answers.js",
	"answers/normalize.js",
	"answers/raw.js",
	"bar/baz/foo.js",
	"bar/foo.js",
	"ext/build.js",
	"ext/build.mjs",
	"foo/bar/baz/quux.js",
	"simple.js",
	"x/dupe.js",
	"y/dupe.js",
];

const FIXTURES = "test/fixtures/tasks";

// Excluded or non-task files that only discovery tests care about
const EXTRAS = ["_private.js", "_drafts/hidden.js", "data.json"];

export default {
	name: "Task discovery",
	beforeAll () {
		for (let path of [...PATHS, ...EXTRAS]) {
			let dest = `${FIXTURES}/${path}`;
			mkdirSync(dirname(dest), { recursive: true });
			let contents = path.endsWith(".json")
				? "{}\n"
				: `export default { marker: "${path}" };\n`;
			writeFileSync(dest, contents);
		}
	},
	afterAll () {
		rmSync("test/fixtures", { recursive: true, force: true });
	},
	tests: [
		{
			name: "resolveTask",
			run: query => resolveTask(query, PATHS),
			tests: [
				{
					name: "Filename alone",
					arg: "quux",
					expect: "foo/bar/baz/quux.js",
				},
				{
					name: "Hyphenated partial suffix",
					arg: "baz-quux",
					expect: "foo/bar/baz/quux.js",
				},
				{
					name: "Slash-separated suffix",
					arg: "baz/quux",
					expect: "foo/bar/baz/quux.js",
				},
				{
					name: "Longer hyphenated suffix",
					arg: "bar-baz-quux",
					expect: "foo/bar/baz/quux.js",
				},
				{
					name: "Mixed separators",
					arg: "bar/baz-quux",
					expect: "foo/bar/baz/quux.js",
				},
				{
					name: "Full hyphenated path",
					arg: "foo-bar-baz-quux",
					expect: "foo/bar/baz/quux.js",
				},
				{
					name: "Full path",
					arg: "foo/bar/baz/quux",
					expect: "foo/bar/baz/quux.js",
				},
				{
					name: "Proximity: closer to the actual path wins",
					arg: "foo",
					expect: "bar/foo.js",
				},
				{
					name: "Deeper twin still reachable via a longer query",
					arg: "baz-foo",
					expect: "bar/baz/foo.js",
				},
				{
					name: "Hyphenated query prefers the literal filename",
					arg: "answers-normalize",
					expect: "answers-normalize.js",
				},
				{
					name: "Slash query targets the nested file",
					arg: "answers/normalize",
					expect: "answers/normalize.js",
				},
				{
					name: "Filename alone matches only the nested file",
					arg: "normalize",
					expect: "answers/normalize.js",
				},
				{
					name: "Proximity outranks literalness across levels",
					run: () => resolveTask("a-foo", ["a/foo.js", "b/a-foo.js"]),
					expect: "a/foo.js",
				},
				{
					name: "Query matching both a filename and a directory gets the file",
					arg: "answers",
					expect: "answers.js",
				},
				{
					name: "Directory-only query does not match",
					arg: "bar",
					throws: true,
				},
				{
					name: "Unknown query throws",
					arg: "nope",
					throws: true,
				},
				{
					name: "Empty query throws",
					arg: "",
					throws: true,
				},
				{
					name: "Trailing slash throws",
					arg: "quux/",
					throws: true,
				},
				{
					name: "Extension-qualified query",
					arg: "quux.js",
					expect: "foo/bar/baz/quux.js",
				},
				{
					name: "Extension picks between extension twins",
					arg: "build.mjs",
					expect: "ext/build.mjs",
				},
				{
					name: "Extension twins are ambiguous without one",
					arg: "build",
					throws: true,
				},
				{
					name: "Extension filters out other extensions entirely",
					run: () => resolveTask("foo.mjs", ["foo.js", "a/foo.mjs"]),
					expect: "a/foo.mjs",
				},
				{
					name: "Query with an extension nothing has throws",
					run: () => resolveTask("build.js", ["x/build.mjs"]),
					throws: true,
				},
				{
					name: "Ambiguity error lists distinguishing ids",
					run: () => {
						try {
							return resolveTask("dupe", PATHS);
						}
						catch (e) {
							return e.message;
						}
					},
					expect: `Ambiguous task "dupe": matches x-dupe, y-dupe. Use a more specific reference.`,
				},
				{
					name: "Empty path list throws a config hint",
					run: () => {
						try {
							return resolveTask("anything", []);
						}
						catch (e) {
							return e.message;
						}
					},
					expect: `No task files found. Check the "tasks" config option.`,
				},
			],
		},
		{
			name: "taskId",
			run: path => taskId(path, PATHS),
			tests: [
				{
					name: "Unique filename",
					arg: "foo/bar/baz/quux.js",
					expect: "quux",
				},
				{
					name: "Nested file whose filename is unique",
					arg: "answers/normalize.js",
					expect: "normalize",
				},
				{
					name: "Literal hyphenated filename",
					arg: "answers-normalize.js",
					expect: "answers-normalize",
				},
				{
					name: "Filename shadowed by a closer twin",
					arg: "bar/baz/foo.js",
					expect: "baz-foo",
				},
				{
					name: "Filename tied with a twin",
					arg: "x/dupe.js",
					expect: "x-dupe",
				},
				{
					name: "Extension twins get extension-qualified ids",
					run: () => ["ext/build.js", "ext/build.mjs"].map(p => taskId(p, PATHS)),
					expect: ["build.js", "build.mjs"],
				},
				{
					name: "Falls back to the slash path when every hyphenated form loses",
					run: () => taskId("a/b.js", ["a/b.js", "b.js", "a-b.js"]),
					expect: "a/b",
				},
			],
		},
		{
			name: "Config taskPaths",
			run: async tasks => (await Config.from({ tasks })).taskPaths.sort(),
			tests: [
				{
					name: "String shorthand keeps the default exclude",
					arg: `${FIXTURES}/**/*.{js,mjs}`,
					expect: PATHS.map(p => `${FIXTURES}/${p}`),
				},
				{
					name: "Explicit exclude replaces the default",
					run: async () =>
						(
							await Config.from({
								tasks: { include: `${FIXTURES}/**/*.js`, exclude: [] },
							})
						).taskPaths
							.filter(p => p.includes("_"))
							.sort(),
					expect: [`${FIXTURES}/_drafts/hidden.js`, `${FIXTURES}/_private.js`],
				},
				{
					name: "Globs decide extensions; directories never match",
					arg: `${FIXTURES}/**`,
					expect: [...PATHS, "data.json"].sort().map(p => `${FIXTURES}/${p}`),
				},
				{
					name: "Array of globs",
					arg: [`${FIXTURES}/x/*.js`, `${FIXTURES}/y/*.js`],
					expect: [`${FIXTURES}/x/dupe.js`, `${FIXTURES}/y/dupe.js`],
				},
				{
					name: "Literal single-file glob",
					arg: `${FIXTURES}/simple.js`,
					expect: [`${FIXTURES}/simple.js`],
				},
				{
					name: "Empty include is empty, not the default",
					arg: [],
					expect: [],
				},
				{
					name: "Zero matches",
					arg: `${FIXTURES}/nonexistent/**/*.js`,
					expect: [],
				},
				{
					name: "Self-overwrites: same array on every access",
					run: async () => {
						let config = await Config.from({ tasks: `${FIXTURES}/x/*.js` });
						return config.taskPaths === config.taskPaths;
					},
					expect: true,
				},
				{
					name: "Override (CLI/programmatic) wins over the config-file tasks",
					run: async () =>
						(
							await Config.from(
								{ tasks: `${FIXTURES}/x/*.js` },
								{ tasks: `${FIXTURES}/y/*.js` },
							)
						).taskPaths,
					expect: [`${FIXTURES}/y/dupe.js`],
				},
			],
		},
		{
			name: "Config resolution / Task.load",
			tests: [
				{
					name: "Config resolves a query to a path; Task.load imports the def",
					run: async () => {
						let config = await Config.from({ tasks: `${FIXTURES}/**/*.js` });
						let path = config.resolveTask("baz/quux");
						let task = await Task.load(path);
						return { id: config.taskId(path), marker: task.marker };
					},
					expect: { id: "quux", marker: "foo/bar/baz/quux.js" },
				},
				{
					name: "Task.load returns an inline definition as-is",
					run: async () => {
						let def = { marker: "inline" };
						return (await Task.load(def)) === def;
					},
					expect: true,
				},
				{
					name: "Task.load returns the imported module unstamped (no id leak)",
					run: async () => {
						let module = await import("./fixtures/tasks/foo/bar/baz/quux.js");
						let def = await Task.load("test/fixtures/tasks/foo/bar/baz/quux.js");
						return ["id" in module.default, def === module.default];
					},
					expect: [false, true],
				},
				{
					name: "Ids depend on which tasks each config can see",
					run: async () => {
						let broad = await Config.from({ tasks: `${FIXTURES}/**/*.js` });
						let narrow = await Config.from({ tasks: `${FIXTURES}/bar/baz/*.js` });
						return [
							broad.taskId(broad.resolveTask("baz-foo")),
							narrow.taskId(narrow.resolveTask("foo")),
						];
					},
					expect: ["baz-foo", "foo"],
				},
				{
					name: "config.taskIds lists the shortest unique query for each task",
					run: async () =>
						(await Config.from({ tasks: `${FIXTURES}/**/*.{js,mjs}` })).taskIds,
					expect: [
						"answers",
						"answers-normalize",
						"baz-foo",
						"build.js",
						"build.mjs",
						"foo",
						"normalize",
						"quux",
						"raw",
						"simple",
						"x-dupe",
						"y-dupe",
					],
				},
			],
		},
	],
};
