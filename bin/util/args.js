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
		let option = this.options[key];
		let keyUsed = this.#getKeyUsed(key);
		let value;

		if (keyUsed !== undefined) {
			value = this.#rawParsedArgs[keyUsed];

			if (option.parse) {
				value = option.parse(value);
			}

			if (option.validate && !option.validate(value)) {
				// Ignore invalid values
				value = undefined;
			}
		}

		value ??= option.default;
		this.#args[key] = value;
	}

	get #optionsChanged () {
		let oldKeys = this.#keys;
		let newKeys = Object.keys(this.options);
		let changed = oldKeys + "" !== newKeys + "";
		this.#keys = newKeys;
		return changed;
	}

	get args () {
		if (this.#optionsChanged || !this.#args) {
			this.#args = { _: this._ };
			for (let key in this.options) {
				this.#readOption(key);
			}
		}

		return this.#args;
	}
}
