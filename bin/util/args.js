import minimist from "minimist";

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

	#hasFlag (key, opt) {
		if (key in this.flags) {
			return true;
		}
		if (opt.long && opt.long in this.flags) {
			return true;
		}
		if (opt.short && opt.short in this.flags) {
			return true;
		}
		return false;
	}

	/**
	 * Match positional args (minimist's `_`) to options that declare `positional`.
	 * `positional: true` is treated as 0; numeric values give explicit ordering.
	 * Options already provided via their flag are skipped.
	 * At most one option can have `multiple: true` (acts like rest params).
	 * Mutates this.flags (sets canonical-keyed entries) and this._ (removes consumed values).
	 */
	matchPositionals (schema) {
		let remaining = [...this._];

		let positionals = Object.entries(schema)
			.filter(([key, opt]) => {
				opt.key ??= key;

				if (this.#hasFlag(key, opt)) {
					return false;
				}

				if (opt.positional === true) {
					opt.positional = 0;
				}

				return !isNaN(opt.positional);
			})
			.map(([key, opt]) => ({ key, opt }))
			.sort((a, b) => a.opt.positional - b.opt.positional);

		let multiples = positionals.filter(p => p.opt.multiple);
		if (multiples.length > 1) {
			console.warn(`At most one positional option can accept multiple values, but found ${multiples.length} (${ multiples.map(p => p.opt.long ?? p.key).join(", ") }).`
			+ `Specify all but one via flags to resolve the ambiguity.`);
		}

		for (let i = 0; i < positionals.length; i++) {
			if (remaining.length === 0) {
				break;
			}

			let { opt } = positionals[i];

			if (opt.multiple) {
				this.flags[opt.key] = remaining.splice(0, remaining.length - positionals.length + (i + 1));
			}
			else {
				this.flags[opt.key] = remaining.shift();
			}
		}

		this._ = remaining;

		// Canonicalize: for any flag-provided value under a non-canonical alias
		// (long, short, or kebab variant), rename to the canonical key.
		// Positional matches above already use the canonical key directly.
		for (let key in schema) {
			if (key in this.flags) {
				continue;
			}
			let opt = schema[key];
			let aliases = [];
			if (opt.long) {
				aliases.push(opt.long);
			}
			if (opt.short) {
				aliases.push(opt.short);
			}
			let kebab = key.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
			if (kebab !== key) {
				aliases.push(kebab);
			}
			for (let alias of aliases) {
				if (alias in this.flags) {
					this.flags[key] = this.flags[alias];
					delete this.flags[alias];
					break;
				}
			}
		}
	}

	get args () {
		return { ...this.flags, _: this._ };
	}
}
