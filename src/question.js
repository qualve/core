import Entity from "./entity.js";
import questionData from "../data/questions.json" with { type: "json" };

export default class Question extends Entity {
	get description () {
		return this.data.description;
	}

	get text () {
		if (!this.prompt) {
			return this.description;
		}

		return `${this.description} ${this.prompt}`;
	}

	static {
		this.fromAll(questionData);
	}
}
