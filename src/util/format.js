const DURATION_UNITS = {
	days: 86_400_000,
	hours: 3_600_000,
	minutes: 60_000,
	seconds: 1_000,
};

function msToUnits (ms) {
	let format = {};

	for (const unit in DURATION_UNITS) {
		let unitMs = DURATION_UNITS[unit];
		if (ms >= unitMs) {
			format[unit] = Math.floor(ms / unitMs);
			ms %= unitMs;

			if (format[unit] === 0) {
				// We don't want non-consecutive units, e.g. "1 hour and 3 seconds"
				return format;
			}
		}
	}

	format.milliseconds = ms;
	return format;
}

export function formatDuration (ms, { locale = "en", ...options } = {}) {
	let format = msToUnits(ms);

	// Otherwise Intl.DurationFormat will throw with "Number not integral"
	format.milliseconds = Math.round(format.milliseconds);

	return new Intl.DurationFormat(locale, {
		style: "short",
		maximumFractionDigits: 2,
		...options,
	}).format(format);
}

const SIZE_UNITS = {
	gigabyte: 1024 ** 3,
	megabyte: 1024 ** 2,
	kilobyte: 1024,
};

export function formatSize (bytes, { locale = "en", ...options } = {}) {
	let value = bytes,
		unit = "byte";
	for (let sizeUnit in SIZE_UNITS) {
		let unitBytes = SIZE_UNITS[sizeUnit];
		if (bytes >= unitBytes) {
			unit = sizeUnit;
			value = bytes / unitBytes;
			break;
		}
	}

	return value.toLocaleString(locale, {
		style: "unit",
		unit,
		maximumFractionDigits: 2,
		...options,
	});
}
