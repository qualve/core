import logUpdate from "log-update";

export class ProgressIndicator {
	// Sadly emojis are not supported on some terminals :'(
	// frames = "🕛🕧🕐🕜🕑🕝🕒🕞🕓🕟🕔🕠🕕🕠🕖🕡🕗🕢🕘🕣🕙🕤🕚🕥".split("");
	frames = ["-", "\\", "|", "/"];
	frameIndex = 0;
	#status = "Working...";
	interval = 80;

	constructor (options = {}) {
		Object.assign(this, options);

		if (!this.deferred) {
			this.start();
		}
	}

	start () {
		this.timer = setInterval(() => {
			this.frameIndex = (this.frameIndex + 1) % this.frames.length;
			this.update();
		}, this.interval);
	}

	get frame () {
		return this.frames[this.frameIndex];
	}

	get message () {
		return this.frame + " " + this.status;
	}

	get status () {
		return this.#status;
	}
	set status (value) {
		this.#status = value;
		this.update();
	}

	update (status) {
		if (status !== undefined) {
			this.#status = status;
		}
		logUpdate(this.message);
	}

	stop () {
		clearInterval(this.timer);
		logUpdate.done();
		this.timer = undefined;
	}
}
