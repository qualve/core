import questionData from "../data/questions.json" with { type: "json" };

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

	get text () {
		if (!this.prompt) {
			return this.description;
		}

		return `${this.description} ${this.prompt}`;
	}

	get truncatedId () {
		return truncatedIds[this.id];
	}

	/**
	 * Resolve a (possibly abbreviated) question ID prefix to the full ID.
	 * The prefix must be at least as long as the question's truncated ID.
	 */
	static resolveId (prefix) {
		if (questions[prefix]) {
			return prefix;
		}

		let matches = ids.filter(id => id.startsWith(prefix));

		if (matches.length === 1 && prefix.length >= truncatedIds[matches[0]].length) {
			return matches[0];
		}

		return prefix;
	}

	static fromId (id) {
		return questions[id];
	}
}

export const questions = Object.fromEntries(questionData.map(q => [q.id, new Question(q)]));
export const ids = Object.keys(questions);
export function truncateId (id, all = ids) {
	for (let i = 1; i <= id.length; i++) {
		let prefix = id.slice(0, i);
		let unique = all.every(other => other === id || !other.startsWith(prefix));
		if (unique) {
			return prefix;
		}
	}

	return id;
}

export const truncatedIds = Object.fromEntries(ids.map(id => [id, truncateId(id)]));
