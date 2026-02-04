import minimist from "minimist";

export function readArgs (argv = process.argv.slice(2), availableOptions) {
	let args = minimist(argv);
	let ret = {
		_: args._,
	};

	for (let key in availableOptions) {
		let option = availableOptions[key];
		let long = option.long ?? key;

		if (long in args) {
			ret[key] = args[long];
		}
		else if (option.short && option.short in args) {
			ret[key] = args[option.short];
		}

		if (ret[key] !== undefined) {
			if (option.parse) {
				ret[key] = option.parse(ret[key]);
			}

			if (option.validate && !option.validate(ret[key])) {
				delete ret[key];
			}
		}

		ret[key] ??= option.default;
	}

	return ret;
}
