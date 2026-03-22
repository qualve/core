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

	static from (data) {
		if (!data) {
			throw new Error(`Cannot create ${this.name} from ${data}`);
		}

		if (typeof data === "string") {
			return this.fromId(data);
		}

		let id = data.id;

		if (!this.all[id]) {
			this.all[id] = new this(data);

			if (Object.hasOwn(this, "truncatedIds") && this !== Entity) {
				// Cached truncatedIds are now invalid
				delete this.truncatedIds;
			}
		}

		return this.all[id];
	}

	static fromAll (data) {
		// Two formats for multiple entries:
		// 1. Array of objects with id, OR
		// 2. Object literal with ids as key
		// We canonicalize to the latter for this.all
		this.all ??= {};
		let entities = {};

		if (Array.isArray(data)) {
			for (let entry of data) {
				entities[entry.id] = this.from(entry);
			}
		}
		else {
			for (let id in data) {
				let entry = data[id];
				entry.id ??= id;
				entities[entry.id] = this.from(entry);
			}
		}

		return entities;
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
