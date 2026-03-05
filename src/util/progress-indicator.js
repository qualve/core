import logUpdate from "log-update";

/**
 * Animated spinner that shows task progress via logUpdate.
 * Supports a parent-child tree: only the root owns the logUpdate timer,
 * and children notify the root to re-render the combined display.
 */
export class ProgressIndicator {
	// Sadly emojis are not supported on some terminals :'(
	// frames = "🕛🕧🕐🕜🕑🕝🕒🕞🕓🕟🕔🕠🕕🕠🕖🕡🕗🕢🕘🕣🕙🕤🕚🕥".split("");
	frames = ["-", "\\", "|", "/"];
	frameIndex = 0;
	#status = "";
	prefix = "";
	interval = 80;
	parent = null;
	children = [];

	constructor (options = {}) {
		let { parent, ...rest } = options;
		Object.assign(this, rest);

		if (parent) {
			this.parent = parent;
			parent.children.push(this);
		}
		else if (!this.deferred) {
			// Pass deferred: true to delay start() and let the caller install the indicator
			// in a parent tree before the first render.
			this.start();
		}
	}

	/** Walk up the tree to find the root indicator. */
	get root () {
		return this.parent ? this.parent.root : this;
	}

	/**
	 * Create and register a child indicator.
	 * Children don't own the logUpdate timer — they defer to the root.
	 */
	addChild (options = {}) {
		return new ProgressIndicator({ ...options, parent: this });
	}

	start () {
		this.timer = setInterval(() => {
			this.frameIndex = (this.frameIndex + 1) % this.frames.length;
			this.render();
		}, this.interval);
	}

	get frame () {
		return this.frames[this.frameIndex];
	}

	/**
	 * Full rendered output: own status line plus indented children.
	 * Only the root prefixes the spinner frame.
	 */
	get message () {
		let lines = [];

		if (this.#status) {
			lines.push(this.prefix ? this.prefix + " " + this.#status : this.#status);
		}

		for (let child of this.children) {
			lines.push(child.message.replace(/^/gm, "\t"));
		}

		return lines.join("\n");
	}

	get status () {
		return this.#status;
	}
	set status (value) {
		this.#status = value;
	}

	/** Remove all children from this indicator, preserving the array reference. */
	clearChildren () {
		this.children.length = 0;
	}

	/** Re-render the full tree from the root. */
	render () {
		let root = this.root;
		if (root.timer) {
			logUpdate(root.frame + " " + root.message);
		}
	}

	stop () {
		if (this.parent) {
			// Only the root owns the logUpdate lifecycle; stopping a child would corrupt the display.
			return;
		}

		clearInterval(this.timer);
		this.timer = undefined;

		if (this.children.length > 0) {
			// Tree root with children: clear transient display.
			// The caller logs the final summary.
			logUpdate.clear();
		}
		else {
			// Standalone indicator: persist final status on screen.
			logUpdate(this.status);
			logUpdate.done();
		}
	}
}
