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
		reprompts,
		reprompt,
		transformAnswer,
		default: defaultValue,
		validate,
		invalidMessage,
	} = options;
	try {
		let answer = process.stdin.isTTY ? (await rl.question(prompt + "\n")).trim() : undefined;

		if (!answer) {
			answer = defaultValue;
		}

		if (validate) {
			let isValid = validate.call(options, answer);
			if (!isValid) {
				if (reprompt && reprompts > 0) {
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

/**
 * Prompt the user to pick one task among ambiguous matches, or run them All.
 * @param {string} taskId The ambiguous task id the user typed.
 * @param {{ taskId: string, taskPath: string }[]} candidates Matching tasks.
 * @returns {Promise<{ taskId: string, taskPath: string } | string | null>}
 *   The chosen entry, the taskId (run All), or null if no valid choice was made.
 */
export async function chooseTask (taskId, candidates) {
	// Sort once — locale- and numeric-aware — and drive both the menu and the returned
	// entry from the same array, so the pick always matches the row the user saw.
	candidates.sort((a, b) => a.taskId.localeCompare(b.taskId, undefined, { numeric: true }));
	// Two roots can expose the same id; show the source to tell those rows apart.
	let ids = candidates.map(candidate => candidate.taskId);
	let menu = candidates
		.map((candidate, i) => {
			let dup = ids.indexOf(candidate.taskId) !== ids.lastIndexOf(candidate.taskId);
			let label = dup ? `${candidate.taskId} (${candidate.taskPath})` : candidate.taskId;
			return `  ${i + 1}. ${label}`;
		})
		.join("\n");

	return ask({
		prompt: `Multiple tasks match “${taskId}”:\n${menu}\n  a. All (run every match)\nWhich one?`,
		default: "a",
		reprompt: `Please enter a number 1–${ids.length}, or “a” for All.`,
		validate (answer) {
			answer = answer.toLowerCase();
			return answer === "a" || (/^[1-9]\d*$/.test(answer) && Number(answer) <= ids.length);
		},
		transformAnswer (answer) {
			answer = answer.toLowerCase();
			return answer === "a" ? taskId : candidates[Number(answer) - 1];
		},
	});
}
