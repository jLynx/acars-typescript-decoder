// Core token layouts/scales adapted from python-metar Metar.py, BSD license in notices.
import type { MetarGroup, MetarQuantity } from './types';

const quantity = (text: string, unit: MetarQuantity['unit']): MetarQuantity => ({
	value: Number(text.replace(/^[MP]/, '')),
	unit,
	...(text.startsWith('M') ? { qualifier: 'less-than' as const } : {}),
	...(text.startsWith('P') ? { qualifier: 'greater-than' as const } : {}),
});

function wind(raw: string): MetarGroup | undefined {
	const match = /^(\d{3}|VRB|\/\/\/)(P?\d{2,3})(?:G(P?\d{2,3}))?(KT|MPS|KMH)$/.exec(raw);
	if (!match || (match[1] !== 'VRB' && match[1] !== '///' && Number(match[1]) > 360)) return;
	const unit = { KT: 'kt', MPS: 'm/s', KMH: 'km/h' }[match[4]] as MetarQuantity['unit'];
	return {
		rank: 1,
		key: 'wind',
		value: {
			direction: match[1] === 'VRB' ? 'variable' : match[1] === '///' ? null : Number(match[1]),
			speed: quantity(match[2], unit),
			...(match[3] ? { gust: quantity(match[3], unit) } : {}),
			raw,
		},
	};
}

function visibility(raw: string): MetarGroup | undefined {
	const directional = /^(\d{4})(N|NE|E|SE|S|SW|W|NW)$/.exec(raw);
	if (directional)
		return {
			rank: 3,
			key: 'directionalVisibility',
			append: true,
			value: { value: Number(directional[1]), unit: 'm', direction: directional[2], raw },
		};
	if (raw === 'CAVOK')
		return {
			rank: 3,
			key: 'visibility',
			value: { value: 10000, unit: 'm', qualifier: 'at-least', raw },
			additional: { cavok: true },
		};
	if (/^\d{4}(?:NDV)?$/.test(raw)) {
		const value = Number(raw.slice(0, 4));
		return {
			rank: 3,
			key: 'visibility',
			value: {
				value: value === 9999 ? 10000 : value,
				unit: 'm',
				raw,
				...(value === 9999 ? { qualifier: 'at-least' } : {}),
			},
		};
	}
	const miles = /^([MP])?(?:(\d+) )?(\d+)(?:\/(\d+))?SM$/.exec(raw);
	if (!miles || (miles[4] && Number(miles[4]) === 0)) return;
	return {
		rank: 3,
		key: 'visibility',
		value: {
			...quantity(`${miles[1] ?? ''}${Number(miles[2] ?? 0) + Number(miles[3]) / Number(miles[4] ?? 1)}`, 'SM'),
			raw,
		},
	};
}

function cloud(raw: string): MetarGroup | undefined {
	const match = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/.exec(raw);
	if (!match) {
		if (!['SKC', 'CLR', 'NSC', 'NCD'].includes(raw)) return;
		return { rank: 6, key: 'clouds', append: true, value: { cover: raw, height: null, raw } };
	}
	return {
		rank: 6,
		key: 'clouds',
		append: true,
		value: {
			cover: match[1],
			height: match[2] === '///' ? null : { value: Number(match[2]) * 100, unit: 'ft' },
			...(match[3] ? { type: match[3] } : {}),
			raw,
		},
	};
}

const weatherNames: Record<string, string> = {
	MI: 'shallow',
	PR: 'partial',
	BC: 'patches',
	DR: 'low drifting',
	BL: 'blowing',
	SH: 'showers',
	TS: 'thunderstorm',
	FZ: 'freezing',
	DZ: 'drizzle',
	RA: 'rain',
	SN: 'snow',
	SG: 'snow grains',
	IC: 'ice crystals',
	PL: 'ice pellets',
	GR: 'hail',
	GS: 'small hail or snow pellets',
	UP: 'unknown precipitation',
	BR: 'mist',
	FG: 'fog',
	FU: 'smoke',
	VA: 'volcanic ash',
	DU: 'widespread dust',
	SA: 'sand',
	HZ: 'haze',
	PY: 'spray',
	PO: 'dust or sand whirls',
	SQ: 'squalls',
	FC: 'funnel cloud',
	SS: 'sandstorm',
	DS: 'duststorm',
};

function weather(raw: string): MetarGroup | undefined {
	const match =
		/^(\+|-|VC)?((?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP)*(?:BR|FG|FU|VA|DU|SA|HZ|PY)?(?:PO|SQ|FC|SS|DS)?)$/.exec(
			raw,
		);
	if (!match || !match[2]) return;
	const codes = match[2].match(/../g)!;
	const intensity = { '+': 'heavy', '-': 'light', VC: 'in the vicinity' }[match[1]];
	return {
		rank: 5,
		key: 'presentWeather',
		append: true,
		value: {
			codes: [...(match[1] ? [match[1]] : []), ...codes],
			description: [...(intensity ? [intensity] : []), ...codes.map((code) => weatherNames[code])].join(' · '),
			raw,
		},
	};
}

function runway(raw: string): MetarGroup | undefined {
	const match = /^R(\d{2}[LRC]?)\/([MP]?\d{4})(?:V([MP]?\d{4}))?(FT)?\/?([UDN])?$/.exec(raw);
	if (!match || Number(match[1].slice(0, 2)) < 1 || Number(match[1].slice(0, 2)) > 36) return;
	const unit = match[4] ? 'ft' : 'm';
	return {
		rank: 4,
		key: 'runwayVisibility',
		append: true,
		value: {
			runway: match[1],
			minimum: quantity(match[2], unit),
			...(match[3] ? { maximum: quantity(match[3], unit) } : {}),
			...(match[5] ? { tendency: { U: 'increasing', D: 'decreasing', N: 'unchanged' }[match[5]] } : {}),
			raw,
		},
	};
}

export function readMetarGroup(raw: string): MetarGroup | undefined {
	if (raw.startsWith('RE')) {
		const recent = weather(raw.slice(2));
		if (recent) return { ...recent, rank: 9, key: 'recentWeather', value: { ...(recent.value as object), raw } };
	}
	const shear = /^WS (ALL RWY|(?:RWY|R)(\d{2}[LRC]?))$/.exec(raw);
	if (shear && (!shear[2] || (Number(shear[2].slice(0, 2)) >= 1 && Number(shear[2].slice(0, 2)) <= 36)))
		return { rank: 10, key: 'windShear', append: true, value: { runway: shear[2] ?? 'ALL', raw } };
	const variation = /^(\d{3})V(\d{3})$/.exec(raw);
	if (variation && Number(variation[1]) <= 360 && Number(variation[2]) <= 360)
		return { rank: 2, key: 'windVariation', value: { from: Number(variation[1]), to: Number(variation[2]), raw } };
	const temperatures = /^(M?\d{2}|\/\/)\/(M?\d{2}|\/\/)?$/.exec(raw);
	if (temperatures) {
		const convert = (text?: string) =>
			text && text !== '//' ? { value: Number(text.replace('M', '-')), unit: '°C' as const } : undefined;
		return {
			rank: 7,
			key: 'temperature',
			value: convert(temperatures[1]),
			additional: { dewpoint: convert(temperatures[2]) },
		};
	}
	const pressure = /^([QA])(\d{4})$/.exec(raw);
	if (pressure)
		return {
			rank: 8,
			key: 'pressure',
			value: {
				value: Number(pressure[2]) / (pressure[1] === 'A' ? 100 : 1),
				unit: pressure[1] === 'A' ? 'inHg' : 'hPa',
			},
		};
	return wind(raw) ?? visibility(raw) ?? runway(raw) ?? weather(raw) ?? cloud(raw);
}
