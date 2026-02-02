import { readJSONSync } from "./util.js";

export default class Question {
	constructor (question) {
		this.question = question;
	}

	get id () {
		return this.question.id;
	}

	get description () {
		return this.question.description;
	}

	get prefix () {
		return this.question.prefix ?? this.id;
	}

	get filePath () {
		return `data/${this.id}`;
	}

	static fromId (id) {
		let question = null;
		try {
			question = readJSONSync(`data/${id}/question.json`);
		}
		catch (e) {
			console.error(`Failed to read question data: ${e.message}`, { cause: e });
			process.exit(1);
		}

		question.id ??= id;
		return new Question(question);
	}
}
