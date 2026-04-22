/** Symbol used to cache each (sub)class's `.default` singleton as an own property. */
const DEFAULT_INSTANCE = Symbol("default");

/**
 * Base class for data serialization formats (JSON, CSV, etc.).
 *
 * A Format is a pure encoding spec: it knows how to convert between raw bytes/text
 * and structured JS values, and it carries identity (extensions, MIME types).
 * It does no I/O — reading from disk and producing Blobs lives on {@link File}.
 *
 * Formats are registered as **singleton instances** (not classes) — one per variant —
 * so different configurations of the same format class can coexist (e.g. a default
 * JSON and a compact null-stripping JSON for LLM uploads).
 *
 * ## Deferred registration
 *
 * Construction enqueues the instance for registration; the queue is drained when
 * any lookup happens (or explicitly via `Format.register()`). This means:
 *
 * - Anything (extensions, MIME types, parse/serialize) can live on subclass **instance
 *   class fields**, constructor **options**, or both — by the time a lookup fires, the
 *   synchronous construction chain for every pending instance has completed, so all
 *   fields are fully initialized when `register()` actually runs.
 * - Do not read `Format.byExtension` / `Format.byMimeType` as Maps — they are lookup
 *   methods (`Format.byExtension(ext)`) that drain the queue first.
 *
 * ## Defining a format
 *
 * ```js
 * // Identity via instance options (good for variants):
 * class JsonFormat extends TextFormat {
 *   parse (text) { return JSON.parse(text); }
 * }
 * export const json = new JsonFormat({ extensions: ["json"], mimeType: "application/json" });
 *
 * // Identity via instance class fields:
 * class JsonFormat extends TextFormat {
 *   extensions = ["json"];
 *   mimeTypes = ["application/json"];
 *   parse (text) { return JSON.parse(text); }
 * }
 * export const json = new JsonFormat();
 * ```
 *
 * Both work because registration happens after construction completes.
 *
 * Text formats should extend {@link TextFormat}, binary formats {@link BinaryFormat}.
 * The base class itself is usable as a generic passthrough (identity parse/serialize,
 * `binary` undefined so consumers can auto-detect on read).
 */
export class Format {
	/**
	 * @param {object} [options]
	 * @param {string} [options.extension] - Single extension (prepended to `extensions`).
	 * @param {string[]} [options.extensions] - Extensions this instance handles, without dots.
	 * @param {string} [options.mimeType] - Single MIME type (prepended to `mimeTypes`).
	 * @param {string[]} [options.mimeTypes] - MIME types this instance handles.
	 * @param {Function | object} [options.parse] - Function override for parse, or an options bag merged into parseOptions.
	 * @param {Function | object} [options.serialize] - Function override for serialize, or an options bag merged into serializeOptions.
	 * @param {object} [options.parseOptions] - Defaults passed to parse when this instance is used.
	 * @param {object} [options.serializeOptions] - Defaults passed to serialize when this instance is used.
	 * @param {boolean} [options.latent=false] - Skip auto-registration (neither queues nor registers).
	 * @param {...any} [otherOptions] - Remaining options are merged into both parseOptions and serializeOptions.
	 */
	constructor (options) {
		if (!options) {
			// Singleton pattern: the first no-options construction becomes this class's
			// canonical `.default` instance; subsequent no-options calls return it.
			let Class = this.constructor;
			if (Object.hasOwn(Class, DEFAULT_INSTANCE)) {
				return Class[DEFAULT_INSTANCE];
			}
			Class[DEFAULT_INSTANCE] = this;
		}

		// Enqueue for deferred registration. The queue is drained on first lookup
		// (or via explicit `Format.registerAll()`), by which time subclass class-fields
		// — which initialize after `super()` returns — are fully set.
		Format.#pending.add(this);

		if (!options) {
			return;
		}

		let {
			mimeType, mimeTypes,
			extension, extensions,
			parse, serialize,
			parseOptions, serializeOptions,
			latent,
			...otherOptions
		} = options;

		// Option merging: otherOptions are shared defaults for both directions;
		// parseOptions/serializeOptions specialize; a plain-object parse/serialize is also merged in
		// (so `new JsonFormat({ parse: { reviver } })` works).
		this.parseOptions = Object.assign(
			{},
			otherOptions,
			parseOptions,
			parse && typeof parse === "object" ? parse : undefined,
		);
		this.serializeOptions = Object.assign(
			{},
			otherOptions,
			serializeOptions,
			serialize && typeof serialize === "object" ? serialize : undefined,
		);

		if (typeof parse === "function") {
			this.parse = parse;
		}

		if (typeof serialize === "function") {
			this.serialize = serialize;
		}

		if (extensions) {
			this.extensions = [...extensions];
		}
		else if (extension) {
			this.extensions = [extension];
		}

		if (mimeTypes) {
			this.mimeTypes = [...mimeTypes];
		}
		if (mimeType) {
			this.mimeTypes.unshift(mimeType);
		}

		if (latent) {
			Format.#pending.delete(this);
			return;
		}
	}

	/** Extensions this format handles, without dots. */
	extensions = [];

	/** Primary extension (first entry of `extensions`). */
	get extension () {
		return this.extensions[0];
	}

	/** MIME types this format handles. */
	mimeTypes = [];

	/** Primary MIME type (first entry of `mimeTypes`). */
	get mimeType () {
		return this.mimeTypes[0];
	}

	/**
	 * Whether this format works with Buffers (`true`) or strings (`false`).
	 * The base Format leaves this undefined so consumers can auto-detect on read.
	 */
	binary;

	/** Parse raw bytes/text into a JS value. Identity by default. */
	parse (raw) {
		return raw;
	}

	/** Serialize a JS value into raw bytes/text. Identity by default. */
	serialize (data, options) {
		return data;
	}

	/**
	 * Eagerly register this instance now, bypassing the deferred queue.
	 * Usually unnecessary — construction enqueues and lookups drain — but useful
	 * when you need the registry to see this instance before any lookup runs.
	 * Idempotent.
	 * @returns {this}
	 */
	register () {
		for (let ext of this.extensions) {
			Format.#byExtension.set(ext, this);
		}

		for (let mt of this.mimeTypes) {
			Format.#byMimeType.set(mt, this);
		}

		Format.#pending.delete(this);
		return this;
	}

	// ===== Registry (static, managing formats as a whole) =====

	/** Instances queued for registration; drained on first lookup. */
	static #pending = new Set();

	/** Extension (without dot) → Format instance. */
	static #byExtension = new Map();

	/** MIME type → Format instance. */
	static #byMimeType = new Map();

	/**
	 * Canonical singleton instance of this (sub)class. Lazily created on first access
	 * using class-field defaults for identity (extensions, mimeTypes, etc.). Cached as
	 * an own property on the (sub)class via {@link DEFAULT_INSTANCE} so inheritance
	 * doesn't share a parent's default with a subclass.
	 *
	 * ```js
	 * class JsonFormat extends TextFormat {
	 *   extensions = ["json"];
	 *   mimeTypes = ["application/json"];
	 *   parse (text) { return JSON.parse(text); }
	 * }
	 * export const json = JsonFormat.default;
	 * ```
	 */
	static get default () {
		// The constructor caches on first no-options call, so `new this()` both
		// returns and (on first call) memoizes the singleton.
		return Object.hasOwn(this, DEFAULT_INSTANCE) ? this[DEFAULT_INSTANCE] : new this();
	}

	/** Drain the pending queue — register every queued instance. */
	static registerAll () {
		for (let fmt of Format.#pending) {
			fmt.register();
		}
	}

	/** Look up a format by extension (without dot). Drains pending registrations first. */
	static byExtension (ext) {
		Format.registerAll();
		return Format.#byExtension.get(ext);
	}

	/** Look up a format by MIME type. Drains pending registrations first. */
	static byMimeType (mt) {
		Format.registerAll();
		return Format.#byMimeType.get(mt);
	}

	/**
	 * All registered Format instances (deduplicated across the extension and MIME-type
	 * registries). Drains pending registrations first.
	 */
	static get all () {
		Format.registerAll();
		return new Set([...Format.#byExtension.values(), ...Format.#byMimeType.values()]);
	}
}

export default Format;

/** Abstract base for text formats. Sets `binary = false`. */
export class TextFormat extends Format {
	binary = false;
}

/** Abstract base for binary formats. Sets `binary = true`. */
export class BinaryFormat extends Format {
	binary = true;
}
