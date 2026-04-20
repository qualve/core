import ArgsReader from "../bin/util/args.js";

export default {
	name: "ArgsReader",
	run: spec => new ArgsReader(spec.argv, spec.options).args,
	check: { subset: true, deep: true },
	tests: [
		{
			name: "Auto-kebab long flag derivation",
			description:
				"Long flag is auto-derived from the camelCase option key as kebab-case when no explicit `long:` is set.",
			tests: [
				{
					name: "Derived long flag from camelCase key",
					tests: [
						{
							name: "Single-segment key (identity kebab form)",
							arg: { argv: ["--config"], options: { config: {} } },
							expect: { config: true },
						},
						{
							name: "Two-segment camelCase key",
							arg: { argv: ["--dry-run"], options: { dryRun: {} } },
							expect: { dryRun: true },
						},
						{
							name: "Multi-segment camelCase key",
							arg: { argv: ["--items-per-page"], options: { itemsPerPage: {} } },
							expect: { itemsPerPage: true },
						},
						{
							name: "Key with acronym run",
							arg: { argv: ["--api-key"], options: { APIKey: {} } },
							expect: { APIKey: true },
						},
					],
				},
				{
					name: "Short flag still works when option has a derived long",
					arg: { argv: ["-p"], options: { itemsPerPage: { short: "p" } } },
					expect: { itemsPerPage: true },
				},
				{
					name: "Explicit long: overrides derived form",
					tests: [
						{
							name: "Explicit long is accepted",
							arg: {
								argv: ["--simulate"],
								options: { dryRun: { long: "simulate" } },
							},
							expect: { dryRun: true },
						},
						{
							name: "Derived kebab form is NOT accepted when overridden",
							arg: { argv: ["--dry-run"], options: { dryRun: { long: "simulate" } } },
							check: actual => !("dryRun" in actual),
						},
					],
				},
				{
					name: "CamelCase CLI form is not matched",
					arg: { argv: ["--dryRun"], options: { dryRun: {} } },
					check: actual => !("dryRun" in actual),
				},
			],
		},
	],
};
