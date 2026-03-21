import Entity from "./entity.js";
import questionData from "../data/questions.json" with { type: "json" };

export default class Question extends Entity {
	get description () {
		return this.data.description;
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

	static all = Object.fromEntries(questionData.map(q => [q.id, new Question(q)]));
}
