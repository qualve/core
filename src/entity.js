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
}
