import minimist from "minimist";

export default class ArgsReader {
	#rawParsedArgs;
	#args;
	#keys;

	constructor (argv = process.argv.slice(2), options) {
		this.argv = argv;
		this.options = options;
		this.#rawParsedArgs = minimist(argv);
	}

	get _ () {
		return this.#rawParsedArgs._;
	}

	#getKeyUsed (key) {
		let option = this.options[key];
		let long = option.long ?? key;
		let args = this.#rawParsedArgs;

		if (long in args) {
			return long;
		}
		else if (option.short && option.short in args) {
			return option.short;
		}
	}

	#readOption (key) {
		let keyUsed = this.#getKeyUsed(key);

		if (keyUsed !== undefined) {
			this.#args[key] = this.#rawParsedArgs[keyUsed];
		}
	}

	get #optionsChanged () {
		let oldKeys = this.#keys;
		let newKeys = Object.keys(this.options);
		let changed = oldKeys + "" !== newKeys + "";
		this.#keys = newKeys;
		return changed;
	}

	/**
	 * Match positional args (minimist's `_`) to options with `positional` set.
	 * `positional: true` is treated as 0, numbers give explicit ordering.
	 * Options already provided via their flag are skipped.
	 * At most one option can have `multiple: true` (acts like rest params).
	 */
	#matchPositionals () {
		let remaining = [...this._];

		// Collect positional defs, skipping any already provided via flag
		let positionals = Object.entries(this.options)
			.filter(([key, opt]) => {
				opt.key ??= key;

				if (this.#getKeyUsed(key) !== undefined) {
					return false;
				}

				if (opt.positional === true) {
					opt.positional = 0;
				}

				return !isNaN(opt.positional);
			})
			.map(([key, opt]) => opt)
			.sort((a, b) => a.positional - b.positional);


		let multiples = positionals.filter(o => o.multiple);
		if (multiples.length > 1) {
			console.warn(`At most one positional option can accept multiple values, but found ${multiples.length} (${ multiples.map(o => o.long ?? o.key).join(", ") }).`
			+ `Specify all but one via flags to resolve the ambiguity.`)
		}

		for (let i = 0; i < positionals.length; i++) {
			if (remaining.length === 0) {
				break;
			}

			let opt = positionals[i];

			if (opt.multiple) {
				this.#args[opt.key] = remaining.splice(0, remaining.length - positionals.length + (i + 1));
			}
			else {
				this.#args[opt.key] = remaining.shift();
			}
		}

		this.#args._ = remaining;
	}

	get args () {
		if (this.#optionsChanged || !this.#args) {
			this.#args = {};
			for (let key in this.options) {
				this.#readOption(key);
			}
			this.#matchPositionals();
		}

		return this.#args;
	}
}
