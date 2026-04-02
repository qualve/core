import File from "../src/file.js";

/**
 * Minimal context stub for File resolution tests.
 * @param {string} id - Task id
 * @param {object} [entity] - Entity object for resolveValue
 * @param {object} [extra] - Additional context properties (e.g. model)
 */
function context (id, entity, extra) {
	return { id, entity, cwd: "", ...extra };
}

export default {
	name: "File",
	tests: [
		{
			name: "resolveString",
			run: (arg) => File.resolveString(arg),
			tests: [
				{ name: "Simple name", arg: "questions", expect: { glob: null, name: "questions", filename: "questions.json", extension: "json" } },
				{ name: "Filename with extension", arg: "answers-final.json", expect: { glob: null, name: "answers-final", filename: "answers-final.json", extension: "json" } },
				{
					name: "Glob appends .json",
					arg: "coding-*",
					map: (arg) => arg?.glob ?? arg,
					expect: "coding-*.json",
				},
				{
					name: "Glob with extension kept as-is",
					arg: "coding-*.json",
					map: (arg) => arg?.glob ?? arg,
					expect: "coding-*.json",
				},
				{
					name: "Wildcard path glob",
					arg: "*/starting-codebook",
					map: (arg) => arg?.glob ?? arg,
					expect: "*/starting-codebook.json",
				},
				{ name: "Non-string passthrough", arg: { name: "foo" }, expect: { name: "foo" } },
			],
		},
		{
			name: "overrideSource",
			run: (...args) => File.overrideSource(...args),
			tests: [
				{
					name: "Merges CLI filename with source metadata",
					args: [{ name: "answers", schema: { type: "array" }, paginate: true }, "my-answers"],
					check: { subset: true, deep: true },
					expect: { schema: { type: "array" }, paginate: true, name: "my-answers", filename: "my-answers.json" },
				},
				{
					name: "Override string source",
					args: ["old-name", "new-name"],
					map: (arg) => arg?.name ?? arg,
					expect: "new-name",
				},
				{
					name: "Override null source",
					args: [null, "my-file"],
					map: (arg) => arg?.name ?? arg,
					expect: "my-file",
				},
				{
					name: "No override returns source unchanged",
					args: [{ name: "answers" }, null],
					expect: { name: "answers" },
				},
				{
					name: "Strips contents from source",
					args: [{ name: "answers", contents: () => "data" }, "new-answers"],
					map: (arg) => typeof arg === "object" ? "contents" in arg : arg,
					expect: false,
				},
			],
		},
		{
			name: "String source resolution",
			run (arg) {
				let file = File.get(arg, context("test"));
				return { name: file.name, filename: file.filename, extension: file.extension, glob: file.glob };
			},
			tests: [
				{ name: "Plain name", arg: "questions", expect: { name: "questions", filename: "questions.json", extension: "json", glob: null } },
				{ name: "Filename with extension", arg: "answers-final.json", expect: { name: "answers-final", filename: "answers-final.json", extension: "json", glob: null } },
				{
					name: "Relative path",
					arg: "../codebooks-merged.json",
					map: (arg) => arg?.name ?? arg,
					expect: "codebooks-merged",
				},
				{
					name: "Glob pattern",
					arg: "coding-*",
					map: (arg) => arg?.glob ?? arg,
					expect: "coding-*.json",
				},
			],
		},
		{
			name: "Object source resolution",
			run (arg) {
				let file = File.get(arg, context("test"));
				return { name: file.name, filename: file.filename, extension: file.extension };
			},
			tests: [
				{ name: "Simple name", arg: { name: "codebook" }, expect: { name: "codebook", filename: "codebook.json", extension: "json" } },
				{
					name: "Name with suffix",
					arg: { name: "answers-normalized", suffix: "-unique" },
					expect: { name: "answers-normalized", filename: "answers-normalized-unique.json", extension: "json" },
				},
				{ name: "Custom extension", arg: { name: "output", extension: "txt" }, expect: { name: "output", filename: "output.txt", extension: "txt" } },
				{ name: "Extension from filename", arg: { filename: "output.csv" }, expect: { name: "output", filename: "output.csv", extension: "csv" } },
				{ name: "Name from filename", arg: { filename: "answers-raw.json" }, expect: { name: "answers-raw", filename: "answers-raw.json", extension: "json" } },
			],
		},
		{
			name: "Suffix-only (name from task id)",
			run (source, id) {
				let file = File.get(source, context(id));
				return { name: file.name, filename: file.filename };
			},
			tests: [
				{ name: "Suffix derives name from task id", args: [{ suffix: "-normalized" }, "answers-normalize"], expect: { name: "answers-normalize", filename: "answers-normalize-normalized.json" } },
				{ name: "Empty source uses task id", args: [{}, "my-task"], expect: { name: "my-task", filename: "my-task.json" } },
			],
		},
		{
			name: "Dynamic sources (resolveValue)",
			tests: [
				{
					name: "Name as method function",
					run () {
						let file = File.get({ name () { return `coding-${this.model}`; } }, context("test", null, { model: "gpt-4" }));
						return file.name;
					},
					expect: "coding-gpt-4",
				},
				{
					name: "Description as arrow function with entity",
					run () {
						let file = File.get({
							name: "codebook",
							description: question => `codebook for "${question.text}"`,
						}, context("test", { text: "What tools do you use?" }));
						return file.description;
					},
					expect: 'codebook for "What tools do you use?"',
				},
				{
					name: "Description as method using this.config",
					run () {
						let ctx = context("test", null, { config: { survey: { name: "CSS", description: "about CSS usage" } } });
						let file = File.get({
							name: "questions",
							description () { let { survey } = this.config; return `All questions from the ${survey.name} survey`; },
						}, ctx);
						return file.description;
					},
					expect: "All questions from the CSS survey",
				},
				{
					name: "Static string description",
					run () {
						let file = File.get({ name: "coded", description: "coded answers" }, context("test"));
						return file.description;
					},
					expect: "coded answers",
				},
			],
		},
		{
			name: "Direct metadata properties",
			tests: [
				{
					name: "paginate on source",
					run () {
						return File.get({ name: "answers", paginate: true }, context("test")).paginate;
					},
					expect: true,
				},
				{
					name: "schema on source",
					run () {
						let schema = { type: "array", items: { type: "object" } };
						return File.get({ name: "general-codes", schema }, context("test")).schema;
					},
					expect: { type: "array", items: { type: "object" } },
				},
				{
					name: "paginate defaults to undefined without parent",
					run () {
						return File.get({ name: "test" }, context("test")).paginate;
					},
					expect: undefined,
				},
			],
		},
		{
			name: "Inherited properties via parent",
			run (parentSource, childSource, prop) {
				let parent = File.get(parentSource, context("test"));
				let child = File.get(childSource, context("test"));
				child.parent = parent;
				return child[prop];
			},
			tests: [
				{ name: "Child inherits schema", args: [{ schema: { type: "array" } }, { filename: "a.json" }, "schema"], expect: { type: "array" } },
				{ name: "Child own schema wins", args: [{ schema: { type: "array" } }, { filename: "a.json", schema: { type: "object" } }, "schema"], expect: { type: "object" } },
				{ name: "Child inherits paginate", args: [{ paginate: true }, { filename: "a.json" }, "paginate"], expect: true },
			],
		},
		{
			name: "Real-world task patterns",
			tests: [
				{
					name: "answersUnique: name + suffix + paginate",
					run () {
						let file = File.get({ name: "answers-normalized", suffix: "-unique", paginate: true }, context("test"));
						return { name: file.name, filename: file.filename, paginate: file.paginate };
					},
					expect: { name: "answers-normalized", filename: "answers-normalized-unique.json", paginate: true },
				},
				{
					name: "answersCoded: dynamic name from model",
					run () {
						let file = File.get({ name () { return `coding-${this.model}`; } }, context("test", null, { model: "gemini-3-flash" }));
						return { name: file.name, filename: file.filename };
					},
					expect: { name: "coding-gemini-3-flash", filename: "coding-gemini-3-flash.json" },
				},
				{
					name: "codebooksMerged: dynamic name with path",
					run () {
						let file = File.get({ name: () => "../codebooks-merged" }, context("test"));
						return { name: file.name, filename: file.filename };
					},
					expect: { name: "../codebooks-merged", filename: "../codebooks-merged.json" },
				},
				{
					name: "consensus: glob input, string output",
					run () {
						let input = File.get("coding-*", context("consensus"));
						let output = File.get("consensus", context("consensus"));
						return { inputGlob: input.glob, outputName: output.name, outputFilename: output.filename };
					},
					expect: { inputGlob: "coding-*.json", outputName: "consensus", outputFilename: "consensus.json" },
				},
				{
					name: "CLI -i override preserves metadata",
					run () {
						let overridden = File.overrideSource({ name: "answers", paginate: true }, "custom-answers");
						let file = File.get(overridden, context("test"));
						return { name: file.name, filename: file.filename, paginate: file.paginate };
					},
					expect: { name: "custom-answers", filename: "custom-answers.json", paginate: true },
				},
			],
		},
	],
};
