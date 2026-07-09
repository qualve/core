import { compactJson } from "../src/file.js";

export default {
	name: "compactJson",
	run: (data, options) => compactJson.serialize(data, options),
	tests: [
		{
			name: "Produces no indentation",
			arg: { a: 1, b: 2 },
			expect: '{"a":1,"b":2}',
		},
		{
			name: "Strips null values",
			arg: { a: 1, b: null, c: 3 },
			expect: '{"a":1,"c":3}',
		},
		{
			name: "Strips undefined values",
			arg: { a: 1, b: undefined, c: 3 },
			expect: '{"a":1,"c":3}',
		},
		{
			name: "Keeps nested values",
			arg: { a: 1, b: [1, null, 3], c: { d: null, e: 2 } },
			expect: '{"a":1,"b":[1,null,3],"c":{"e":2}}',
		},
		{
			name: "Call-site indent override",
			args: [{ a: 1 }, { indent: "  " }],
			expect: '{\n  "a": 1\n}',
		},
		{
			name: "Call-site replacer override",
			args: [{ a: 1, b: null }, { replacer: null }],
			expect: '{"a":1,"b":null}',
		},
	],
};
