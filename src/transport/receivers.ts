import { isRecord } from '@/validation';
import type { AcarsInput } from '@/types';
import type { ReceiverRecord } from './types';

const string = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function timestamp(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
	if (
		isRecord(value) &&
		typeof value.sec === 'number' &&
		Number.isFinite(value.sec) &&
		typeof value.usec === 'number' &&
		Number.isFinite(value.usec) &&
		value.usec >= 0 &&
		value.usec < 1_000_000
	)
		return value.sec * 1000 + value.usec / 1000;
}

function direction(value: unknown, block: string): AcarsInput['direction'] {
	if (['uplink', 'ground_to_air', 'gnd2air'].includes(string(value) ?? '')) return 'uplink';
	if (['downlink', 'air_to_ground', 'air2gnd'].includes(string(value) ?? '')) return 'downlink';
	if (/^[A-X]$/.test(block)) return 'uplink';
	if (/^\d$/.test(block)) return 'downlink';
}

/** JSON application records from acarsdec/vdlm2dec and nested dumpvdl2/dumphfdl outputs. */
export function adaptReceiverRecord(value: unknown): ReceiverRecord | undefined {
	if (!isRecord(value)) return;
	if (typeof value.LABEL === 'string') return adaptJaero(value);
	const envelope = isRecord(value.vdl2) ? value.vdl2 : isRecord(value.hfdl) ? value.hfdl : value;
	const found = findAcars(envelope);
	if (!found) return;
	const aero = isRecord(value.isu) ? value.isu : undefined;
	const src = aero && isRecord(aero.src) ? aero.src.type : undefined;
	const aeroDirection =
		src === 'Aircraft Earth Station' ? 'downlink' : src === 'Ground Earth Station' ? 'uplink' : undefined;
	const message = applicationInput(aero ? { ...found, direction: aeroDirection } : found, !aero);
	const time = timestamp(envelope.t ?? envelope.timestamp ?? value.t ?? value.timestamp);
	if (time !== undefined) message.receivedAt = time;
	return {
		message,
		source: sourceId(value, envelope),
		raw: structuredClone(value),
		...(typeof found.err === 'number' ? { errors: found.err } : {}),
	};
}

function applicationInput(found: Record<string, unknown>, inferDirection = true): AcarsInput {
	const block = string(found.block_id) ?? string(found.blockid) ?? string(found.blk_id) ?? '';
	const end = string(found.end);
	const messageDirection = direction(found.direction ?? found.msg_dir, inferDirection ? block : '');
	return {
		label: string(found.label)!,
		text: applicationText(found, messageDirection),
		registration: string(found.reg) ?? string(found.tail) ?? '',
		mode: string(found.mode) ?? '',
		blockId: block,
		acknowledgement: string(found.ack) ?? '',
		direction: messageDirection,
		messageNumber:
			string(found.msgno) ??
			(typeof found.msg_num === 'string' ? found.msg_num + (string(found.msg_num_seq) ?? '') : undefined),
		flight: string(found.flight) ?? string(found.flight_id),
		continuation: end === undefined ? found.more === true : end === 'ETB' || end === '\u0017',
	};
}

function applicationText(found: Record<string, unknown>, messageDirection: AcarsInput['direction']): string {
	let text = string(found.text) ?? string(found.txt) ?? string(found.msg_text) ?? '';
	const sublabel = string(found.sublabel);
	const mfi = string(found.mfi);
	if (found.label === 'H1' && sublabel && /^[A-Z0-9]{2}$/.test(sublabel) && !/^(?:#\w{2}B|- #\w{2})/.test(text)) {
		const prefix = messageDirection === 'uplink' ? `- #${sublabel}` : `#${sublabel}B`;
		text = `${prefix}${mfi && /^[A-Z0-9]{2}$/.test(mfi) ? `/${mfi} ` : ''}${text}`;
	}
	return text;
}

function sourceId(value: Record<string, unknown>, envelope: Record<string, unknown>): string {
	const station = string(envelope.station) ?? string(value.station_id) ?? '';
	const frequency = envelope.freq ?? value.freq ?? value.channel ?? '';
	const format = value.vdl2 ? 'vdl2' : value.hfdl ? 'hfdl' : value.isu ? 'aero' : 'acars';
	return `${format}:${station}:${typeof frequency === 'number' || typeof frequency === 'string' ? frequency : ''}`;
}

function findAcars(value: Record<string, unknown>): Record<string, unknown> | undefined {
	const candidates: Array<Record<string, unknown>> = [value];
	for (let index = 0; index < candidates.length && index < 64; index++) {
		const item = candidates[index];
		if (
			typeof item.label === 'string' &&
			item.label.length === 2 &&
			(typeof item.text === 'string' ||
				typeof item.txt === 'string' ||
				typeof item.msg_text === 'string' ||
				(typeof item.mode === 'string' && typeof item.ack === 'string' && typeof item.blk_id === 'string'))
		)
			return item;
		for (const key of ['acars', 'avlc', 'lpdu', 'hfnpdu', 'data', 'isu'])
			if (isRecord(item[key])) candidates.push(item[key]);
	}
}

/** JAERO native JSON fields (mainwindow.cpp); valid/NONACARS remains receiver evidence, never a local checksum. */
function adaptJaero(value: Record<string, unknown>): ReceiverRecord | undefined {
	if (
		value.NONACARS === true ||
		typeof value.LABEL !== 'string' ||
		value.LABEL.length !== 2 ||
		(value.MESSAGE !== undefined && typeof value.MESSAGE !== 'string') ||
		(value.MESSAGE === undefined && !['MODE', 'TAK', 'BI', 'REG'].every((key) => typeof value[key] === 'string'))
	)
		return;
	const message = applicationInput(
		{
			label: value.LABEL,
			text: value.MESSAGE ?? '',
			reg: value.REG,
			mode: value.MODE,
			ack: value.TAK,
			block_id: value.BI,
			flight: value.FLIGHT,
			more: value.moretocome,
			direction: typeof value.downlink === 'boolean' ? (value.downlink ? 'downlink' : 'uplink') : undefined,
		},
		false,
	);
	const time = timestamp(value.TIME);
	if (time !== undefined) message.receivedAt = time;
	return {
		message,
		source: `aero:${string(value.station) ?? string(value.NAME) ?? ''}:${string(value.GESID) ?? ''}`,
		raw: structuredClone(value),
	};
}
