// Selected remark scales from pinned Python-Metar; retain unsupported tokens.
import type { MetarRemarks, MetarQuantity } from './types';

const quantity = (value: number, unit: MetarQuantity['unit']): MetarQuantity => ({ value, unit });
const temperature = (sign: string, digits: string) => quantity((Number(digits) / 10) * (sign === '1' ? -1 : 1), '°C');
const tendencies = [
	'increasing then decreasing',
	'increasing more slowly',
	'increasing',
	'increasing more quickly',
	'steady',
	'decreasing then increasing',
	'decreasing more slowly',
	'decreasing',
	'decreasing more quickly',
];

export function readMetarRemarks(raw: string): MetarRemarks {
	const remarks: MetarRemarks = { raw, precipitation: [], temperatureExtrema: [], iceAccretion: [], unconsumed: [] };
	const seen = new Set<string>();
	for (const token of raw.split(/\s+/).slice(1)) {
		const key = read(token, remarks, seen) ?? readAccumulations(token, remarks, seen);
		if (!key) remarks.unconsumed.push(token);
		else seen.add(key);
	}
	return remarks;
}

function read(token: string, remarks: MetarRemarks, seen: Set<string>): string | undefined {
	if (/^AO[12]$/.test(token) && !seen.has('automation')) {
		remarks.automation = token as 'AO1' | 'AO2';
		return 'automation';
	}
	const slp = /^SLP(\d{3})$/.exec(token);
	if (slp && !seen.has('seaLevelPressure')) {
		const value = Number(slp[1]) / 10;
		remarks.seaLevelPressure = quantity(value + (value < 50 ? 1000 : 900), 'hPa');
		return 'seaLevelPressure';
	}
	const precise = /^T([01])(\d{3})(?:([01])(\d{3}))?$/.exec(token);
	if (precise && !seen.has('precise')) {
		remarks.preciseTemperature = temperature(precise[1], precise[2]);
		if (precise[3]) remarks.preciseDewpoint = temperature(precise[3], precise[4]);
		return 'precise';
	}
}

function readAccumulations(token: string, remarks: MetarRemarks, seen: Set<string>): string | undefined {
	const precip = /^([P67])(\d{4})$/.exec(token);
	if (precip && !seen.has(`precip-${precip[1]}`)) {
		remarks.precipitation.push({
			period: precip[1] === 'P' ? '1-hour' : precip[1] === '6' ? '3-or-6-hour' : '24-hour',
			amount: quantity(Number(precip[2]) / 100, 'in'),
			raw: token,
		});
		return `precip-${precip[1]}`;
	}
	const six = /^([12])([01])(\d{3})$/.exec(token),
		day = /^4([01])(\d{3})([01])(\d{3})$/.exec(token);
	if (six && !seen.has(`six-${six[1]}`)) {
		remarks.temperatureExtrema.push({
			period: '6-hour',
			kind: six[1] === '1' ? 'maximum' : 'minimum',
			temperature: temperature(six[2], six[3]),
			raw: token,
		});
		return `six-${six[1]}`;
	}
	if (day && !seen.has('day-extrema')) {
		remarks.temperatureExtrema.push(
			{ period: '24-hour', kind: 'maximum', temperature: temperature(day[1], day[2]), raw: token },
			{ period: '24-hour', kind: 'minimum', temperature: temperature(day[3], day[4]), raw: token },
		);
		return 'day-extrema';
	}
	const pressure = /^5([0-8])(\d{3})$/.exec(token);
	if (pressure && !seen.has('pressureChange')) {
		remarks.pressureChange = {
			period: '3-hour',
			magnitude: quantity(Number(pressure[2]) / 10, 'hPa'),
			tendencyCode: Number(pressure[1]),
			tendency: tendencies[Number(pressure[1])],
			raw: token,
		};
		return 'pressureChange';
	}
	const snow = /^4\/(\d{3})$/.exec(token),
		ice = /^I([136])(\d{3})$/.exec(token);
	if (snow && !seen.has('snowDepth')) {
		remarks.snowDepth = quantity(Number(snow[1]), 'in');
		return 'snowDepth';
	}
	if (ice && !seen.has(`ice-${ice[1]}`)) {
		remarks.iceAccretion.push({ hours: Number(ice[1]), depth: quantity(Number(ice[2]) / 100, 'in'), raw: token });
		return `ice-${ice[1]}`;
	}
}
