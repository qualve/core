import File from "../src/file.js";

export default {
	name: "resolveContents()",
	async run (arg) {
		let contents = arg;

		if (this.data?.promise) {
			contents = Promise[this.data.rejects ? "reject" : "resolve"](arg);
		}

		let file = new File({ name: "foo.js", contents }, null);
		await file.resolveContents();

		return file.contents;
	},
	expect: "foo",
	tests: [
		{
			name: "No contents (no-op)",
			expect: undefined,
		},
		{
			arg: "foo",
		},
		{
			arg: () => "foo",
		},
		{
			name: "Promise → resolve",
			data: { promise: true },
			arg: "foo",
		},
		{
			arg: () => Promise.resolve("foo"),
		},
		{
			name: "Custom thenable",
			arg: { then: resolve => resolve("foo") },
		},
		{
			name: "Dynamic import",
			arg: import(`data:text/javascript,export const features = "foo"`).then(m => m.features),
		},
		{
			name: "Promise → reject",
			throws: e => e.message.includes("foo.js") && e.message.includes("rejected"),
			tests: [
				{
					data: { promise: true, rejects: true },
					arg: "rejected",
				},
				{
					name: "Function → Promise",
					arg: () => Promise.reject("rejected"),
				},
			],
		},
	],
};
