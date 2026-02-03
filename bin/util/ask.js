import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const defaultOptions = {
	prompt: "Continue?",
	reprompts: 3,
	invalidMessage: "Invalid answer",
	choices: ["Y", "n"],
	default: "Y",
	validate (answer) {
		if (this.choices) {
			return this.choices.includes(answer);
		}
		return true;
	},
};

export async function ask (options = {}) {
	options = { ...defaultOptions, ...options };

	const rl = readline.createInterface({ input: stdin, output: stdout });

	let {
		prompt,
		reprompt,
		transformAnswer,
		default: defaultValue,
		validate,
		invalidMessage,
	} = options;
	try {
		let answer = (await rl.question(prompt + "\n")).trim();

		if (!answer) {
			answer = defaultValue;
		}
		else if (validate) {
			let isValid = validate.call(options, answer);
			if (!isValid) {
				if (reprompt) {
					return ask({ ...options, prompt: reprompt, reprompts: reprompts - 1 });
				}
				else {
					console.error(invalidMessage);
					return null;
				}
			}
		}

		return transformAnswer ? transformAnswer(answer) : answer;
	}
	finally {
		rl.close();
	}
}

const defaultChoiceOptions = {
	prompt: "Continue?",
	reprompt: "Please type Y, n, or press Enter.",
	choices: ["Y", "n"],
	default: "Y",
	caseInsensitive: true,
	validate (answer) {
		return this.choices.includes(answer.toLowerCase());
	},
	transformAnswer (answer) {
		return answer.toLowerCase();
	},
};

export async function choose (options = {}) {
	options = { ...defaultOptions, ...defaultChoiceOptions, ...options };

	options.choices = options.choices.map(choice => choice.toLowerCase());
	options.default = options.default.toLowerCase();
	let displayedChoices = options.choices
		.map(choice => choice.toLowerCase())
		.map(choice => (choice === options.default ? choice.toUpperCase() : choice));
	options.prompt = `${options.prompt} [${displayedChoices.join("/")}]`;

	return ask(options);
}

let defaultConfirmOptions = {
	choices: ["Y", "n"],
	default: "Y",
	transformAnswer (answer) {
		return answer.toLowerCase() === "y";
	},
};

export async function confirm (options = {}) {
	return choose({ ...defaultConfirmOptions, ...options });
}
