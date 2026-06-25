import Model from "../src/model.js";

// Two ids share a 1-char prefix ("react", "redux"); one is unique ("vue").
let model = new Model("question", {
	data: [{ id: "react" }, { id: "redux" }, { id: "vue" }],
	multiple: true,
});

export default {
	name: "Model.validate",
	run: value => model.validate(value),
	tests: [
		{ name: "Exact id matches", arg: "react", expect: true },
		{
			name: "Empty string rejected (was: listed every id)",
			arg: "",
			expect: false,
		},
		{
			name: "Unambiguous prefix suggested",
			arg: "rea",
			expect: ["react"],
		},
		{
			name: "Ambiguous prefix surfaces all matches",
			arg: "re",
			expect: ["react", "redux"],
		},
		{
			name: "Unique 1-char prefix suggested",
			arg: "v",
			expect: ["vue"],
		},
		{ name: "Non-matching prefix rejected", arg: "xyz", expect: false },
	],
};
