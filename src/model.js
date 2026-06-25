import { readJSONSync } from "./util.js";
import Entity from "./entity.js";

/**
 * Manages a collection of entities for a given scope (e.g. "question", "survey").
 * Handles loading, lookup, creation, and ID resolution.
 */
export default class Model {
	#loaded = false;

	constructor (name, spec) {
		this.name = name;
		this.spec = spec;

		for (let key in spec) {
			if (!(key in this)) {
				this[key] = spec[key];
			}
		}

		this.#data = this.spec.data;
		this.Entity ??= Entity;
	}

	get plural () {
		return this.spec.plural ?? this.name + "s";
	}

	#data;
	get data () {
		this.#ensureLoaded();
		return this.#data;
	}

	/** Load data from spec if not yet loaded. */
	#ensureLoaded () {
		let { dataSource } = this.spec;

		// Generally 3 ways to load data:
		// 1. Inline in config (e.g. survey)
		// 2. Single file for all data (e.g. questions)
		// 3. Multiple files, keyed by id (not yet implemented)
		if (this.#data === undefined) {
			if (typeof dataSource === "string") {
				// Single file for all data
				this.#data = readJSONSync(dataSource);
			}
		}

		if (this.#loaded) {
			return;
		}
		this.#loaded = true;

		if (this.multiple) {
			this.#data = this.fromAll(this.#data);
		}
		else {
			this.#data = this.from(this.#data);
		}
	}

	/** Pure lookup by id. Returns undefined if not found. */
	fromId (id) {
		this.#ensureLoaded();
		return this.#all[id];
	}

	/**
	 * Get or create an entity.
	 * String → pure lookup. Object → create if not already cached.
	 */
	from (data) {
		if (!data) {
			throw new Error("Cannot create entity from " + data);
		}

		if (typeof data === "string") {
			return this.fromId(data);
		}

		this.#ensureLoaded();

		let id = data.id;

		if (!this.#all[id]) {
			let entity = new this.Entity(data, this);

			this.#all[id] = entity;
			this.#truncatedIds = null; // invalidate cache
		}

		return this.#all[id];
	}

	/**
	 * Batch-create entities from an array of objects or a keyed object.
	 * Array items must have an `id` property; object keys are used as `id` if missing.
	 */
	fromAll (data) {
		if (!Array.isArray(data)) {
			// Single entity object (has `id`) vs keyed collection (values are entity objects)
			data = data.id
				? [data]
				: Object.entries(data).map(([id, entry]) => {
						entry.id ??= id;
						return entry;
					});
		}

		for (let entry of data) {
			this.from(entry);
		}

		return this.#all;
	}

	/** CLI flag string, e.g. "-q/--question". */
	get flag () {
		if (!this.option) {
			return "";
		}

		let parts = [];
		if (this.option.short) {
			parts.push(`-${this.option.short}`);
		}
		parts.push(`--${this.option.long}`);
		return parts.join("/");
	}

	#all = {};
	get all () {
		this.#ensureLoaded();
		return this.#all;
	}

	get ids () {
		this.#ensureLoaded();
		return Object.keys(this.#all);
	}

	/** Shortest unique prefix for each id, computed lazily. */
	#truncatedIds;
	get truncatedIds () {
		if (!this.#truncatedIds) {
			const ids = this.ids;
			this.#truncatedIds = Object.fromEntries(ids.map(id => [id, this.truncateId(id, ids)]));
		}

		return this.#truncatedIds;
	}

	/**
	 * Validator in the shape expected by the option system: returns `true` for an exact
	 * id match, an array of prefix-matched ids when the value is an abbreviation, or
	 * `false` if nothing plausible matches. The CLI surfaces the array as a
	 * "Did you mean…?" prompt.
	 */
	validate (value) {
		if (!value) {
			return false;
		}
		if (this.fromId(value)) {
			return true;
		}

		let matches = this.ids.filter(id => id.startsWith(value));
		return matches.length > 0 ? matches : false;
	}

	/** Returns the shortest unique prefix for `id` within `all`. */
	truncateId (id, all = this.ids) {
		for (let i = 1; i <= id.length; i++) {
			let prefix = id.slice(0, i);
			if (all.every(other => other === id || !other.startsWith(prefix))) {
				return prefix;
			}
		}

		return id;
	}
}
