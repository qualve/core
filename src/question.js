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

	static fromId (id) {
		return questions[id];
	}
}

export const questions = Object.fromEntries(questionData.map(q => [q.id, new Question(q)]));
export const ids = Object.keys(questions);
