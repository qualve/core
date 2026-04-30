import minimist from "minimist";
import { camelToKebab } from "../../src/options.js";

/**
 * Thin wrapper around minimist that also handles positional argument matching.
 * Argv parsing happens once in the constructor; positional matching is a separate
 * pass triggered by matchPositionals(schema). Schema-aware alias lookup (long, short,
 * camel-vs-kebab) lives in src/options.js so it works for programmatic callers too.
 */
export default class ArgsReader {
	constructor (argv = process.argv.slice(2)) {
		this.argv = argv;
		let parsed = minimist(argv);
		this._ = parsed._ ?? [];
		delete parsed._;
		// Raw flag bag — keys are exactly what minimist produced (long, short, kebab),
		// not yet normalized to canonical option keys.
		this.flags = parsed;
	}

	/**
	 * Move any flag from an alias key (long, short, camel/kebab variant) to its canonical
	 * option key per the schema. Idempotent — calling repeatedly with progressively richer
	 * schemas (L1 → full chain) just picks up any newly-recognized aliases.
	 */
	canonicalize (schema) {
		for (let key in schema) {
			if (key in this.flags) {
				continue;
			}
			let { long, short } = schema[key];
			let alias = [long, short, camelToKebab(key)].find(a => a && a in this.flags);
			if (alias) {
				this.flags[key] = this.flags[alias];
				delete this.flags[alias];
			}
		}
	}

	/**
	 * Match positional args (minimist's `_`) to options that declare `positional`.
	 * `positional: true` is treated as 0; numeric values give explicit ordering.
	 * Options already provided via a flag are skipped, so call canonicalize(schema)
	 * first to move alias-keyed flags into their canonical slot.
	 * At most one option can have `multiple: true` (acts like rest params).
	 */
	matchPositionals (schema) {
		let positionals = Object.entries(schema)
			.filter(([key, opt]) => !(key in this.flags) && (opt.positional === true || typeof opt.positional === "number"))
			.map(([key, opt]) => [key, opt, opt.positional === true ? 0 : opt.positional])
			.sort(([, , a], [, , b]) => a - b);

		let multiples = positionals.filter(([, opt]) => opt.multiple);
		if (multiples.length > 1) {
			console.warn(`At most one positional option can accept multiple values, but found ${multiples.length} (${ multiples.map(([key, opt]) => opt.long ?? key).join(", ") }).`
			+ `Specify all but one via flags to resolve the ambiguity.`);
		}

		let remaining = [...this._];
		for (let i = 0; i < positionals.length && remaining.length > 0; i++) {
			let [key, opt] = positionals[i];
			this.flags[key] = opt.multiple
				? remaining.splice(0, remaining.length - positionals.length + (i + 1))
				: remaining.shift();
		}
		this._ = remaining;
	}

	get args () {
		return { ...this.flags, _: this._ };
	}
}
