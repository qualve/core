/**
 * Generic base class for domain entities looked up by ID.
 * Subclasses must define a static `all` object (id → instance).
 */
export default class Entity {
	constructor (data) {
		this.data = data;

		for (let key in data) {
			if (!(key in this)) {
				this[key] = data[key];
			}
		}
	}

	get id () {
		return this.data.id;
	}

	get truncatedId () {
		return this.constructor.truncatedIds[this.id];
	}

	static fromId (id) {
		return this.all[id];
	}

	static get ids () {
		return Object.keys(this.all);
	}

	/**
	 * Resolve a (possibly abbreviated) ID prefix to the full ID.
	 * The prefix must be at least as long as the entity's truncated ID.
	 */
	static resolveId (prefix) {
		if (this.fromId(prefix)) {
			return prefix;
		}

		let matches = this.ids.filter(id => id.startsWith(prefix));

		if (matches.length === 1 && prefix.length >= this.truncatedIds[matches[0]].length) {
			return matches[0];
		}

		return prefix;
	}

	/** Returns the shortest unique prefix for `id` within the entity set. */
	static truncateId (id, all = this.ids) {
		for (let i = 1; i <= id.length; i++) {
			let prefix = id.slice(0, i);
			if (all.every(other => other === id || !other.startsWith(prefix))) {
				return prefix;
			}
		}

		return id;
	}

	static get truncatedIds () {
		let value = Object.fromEntries(this.ids.map(id => [id, this.truncateId(id)]));
		Object.defineProperty(this, "truncatedIds", { value });
		return value;
	}
}
