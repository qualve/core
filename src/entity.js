export default class Entity {
	constructor (data, type) {
		this.data = data;
		this.type = type;

		for (let key in data) {
			if (!(key in this)) {
				this[key] = data[key];
			}
		}
	}

	/** Shortest unique prefix for this entity's ID among all siblings. */
	get uniquePrefix () {
		return this.type.truncateId(this.id);
	}
}
