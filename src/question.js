import { readJSONSync, readDirectorySync } from "./util.js";

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

	get section () {
		return this.question.section;
	}

	get filePath () {
		return `data/${this.id}`;
	}

	static all = {};

	static #ids = null;
	static get ids () {
		if (!this.#ids) {
			this.#ids = readDirectorySync("data", { type: "directory" });
		}
		return this.#ids;
	}

	static fromId (id) {
		if (this.all[id]) {
			return this.all[id];
		}

		let question = null;
		try {
			question = readJSONSync(`data/${id}/question.json`);
		}
		catch (e) {
			console.error(`Failed to read question data: ${e.message}`, { cause: e });
			process.exit(1);
		}

		question.id ??= id;
		this.all[id] = new Question(question);
		return this.all[id];
	}
}
