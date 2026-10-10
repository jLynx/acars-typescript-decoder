// Doc9705 Ed2 ACSE profile from Wireshark ULCS ASN.1, GPL-2.0-or-later.
import { Bits } from '@/payload/protocols/bits';
import { perLength, perOid, perPayload } from './per';
import * as values from './acse-values';
import type { AtnAcse } from './types';

function titles(bits: Bits, result: AtnAcse, flags: number[], response: boolean): number {
	const names = response ? ['responding'] : ['called', 'calling'];
	let flag = 1;
	for (const name of names) {
		for (const suffix of ['APTitle', 'AEQualifier', 'APInvocationIdentifier', 'AEInvocationIdentifier']) {
			if (flags[flag++]) {
				result.fields[name + suffix] = suffix.endsWith('Identifier')
					? values.signedInteger(bits)
					: values.title(bits, suffix === 'AEQualifier');
				if (response || name === 'called' || suffix.endsWith('Identifier')) result.profileSupported = false;
			}
		}
	}
	return flag;
}

function options(bits: Bits, result: AtnAcse, flags: number[], flag: number): void {
	if (flags[flag++]) {
		result.fields.acseRequirements = perPayload(bits, 1);
		result.profileSupported = false;
	}
	if (flags[flag++]) {
		result.fields.mechanismName = perOid(bits);
		result.profileSupported = false;
	}
	if (flags[flag++]) values.authentication(bits, result);
	if (flags[flag++]) {
		const count = perLength(bits);
		if (count.fragmented || count.length > 16) throw new Error('Too many ACSE context names');
		for (let index = 0; index < count.length; index++) result.fields[`applicationContextName${index}`] = perOid(bits);
		result.profileSupported = false;
	}
	if (flags[flag++]) {
		result.fields.implementationInformation = perPayload(bits, 8);
		result.profileSupported = false;
	}
	if (flags[flag]) values.information(bits, result);
}

function associate(bits: Bits, result: AtnAcse, response: boolean): void {
	const extended = bits.read(1);
	const flags = Array.from({ length: response ? 11 : 15 }, () => bits.read(1));
	if (flags[0]) {
		result.fields.protocolVersion = perPayload(bits, 1);
		result.profileSupported = false;
	}
	result.fields.applicationContextName = perOid(bits);
	if (response) {
		result.fields.result = values.extensibleInteger(bits, 2, 2);
		const provider = bits.read(1);
		result.fields.diagnosticSource = provider ? 'acse-service-provider' : 'acse-service-user';
		result.fields.diagnostic = values.extensibleInteger(bits, provider ? 2 : 4, provider ? 2 : 14);
		const validResult = Number(result.fields.result) >= 0 && Number(result.fields.result) <= 2;
		const validDiagnostic =
			Number(result.fields.diagnostic) >= 0 && Number(result.fields.diagnostic) <= (provider ? 2 : 14);
		if (!validResult || !validDiagnostic) result.profileSupported = false;
	}
	options(bits, result, flags, titles(bits, result, flags, response));
	if (extended) values.extensions(bits, result);
}

function release(bits: Bits, result: AtnAcse, abort: boolean): void {
	const extended = bits.read(1),
		reason = bits.read(1),
		information = bits.read(1);
	if (abort) result.fields.abortSource = values.extensibleInteger(bits, 1, 1);
	if (abort && ![0, 1].includes(Number(result.fields.abortSource))) result.profileSupported = false;
	if (reason) {
		if (abort) {
			result.fields.abortDiagnostic = values.enumValue(bits, 6) + 1;
			result.profileSupported = false;
		} else {
			const value = values.extensibleInteger(bits, 5, 30);
			result.fields.reason = value;
			if (![0, 1, 30].includes(value)) result.profileSupported = false;
		}
	}
	if (information) values.information(bits, result);
	if (extended) values.extensions(bits, result);
}

/** Read an explicitly identified ACSE APDU; application/integrity are not inferred. */
export function decodeAtnAcse(bytes: Uint8Array, bitLength = bytes.length * 8): AtnAcse {
	if (
		!(bytes instanceof Uint8Array) ||
		!bytes.length ||
		bytes.length > 8192 ||
		!Number.isInteger(bitLength) ||
		bitLength <= 0 ||
		bitLength > bytes.length * 8 ||
		bitLength <= (bytes.length - 1) * 8
	)
		throw new RangeError('ATN ACSE requires 1–8192 bytes and a matching bit length');
	const bits = new Bits(bytes);
	const result: AtnAcse = {
		protocol: 'ATN-ACSE',
		type: 'extension',
		raw: bytes.slice(),
		bitLength,
		consumedBits: 0,
		structureComplete: false,
		profileSupported: true,
		integrity: 'unverified',
		fields: {},
		userInformation: [],
		extensions: [],
		notes: [],
		source: {
			repository: 'https://github.com/wireshark/wireshark',
			revision: 'ad85ea3cb5af4e9665f1b3e3cda5bee94b71ab73',
			files: ['epan/dissectors/asn1/atn-ulcs/atn-ulcs.asn'],
		},
	};
	if (bits.read(1)) {
		const index = values.normallySmall(bits);
		result.extensions.push({ index, payload: perPayload(bits, 8).payload });
		result.profileSupported = false;
	} else {
		const choice = bits.constrained(3, 0, 4);
		result.type = (['AARQ', 'AARE', 'RLRQ', 'RLRE', 'ABRT'] as const)[choice];
		try {
			if (choice < 2) associate(bits, result, choice === 1);
			else release(bits, result, choice === 4);
		} catch (error) {
			if (!(error instanceof Error) || !error.message.startsWith('Excluded')) throw error;
			result.notes.push(error.message);
			result.profileSupported = false;
		}
	}
	if (bits.position > bitLength) throw new Error('Truncated ACSE bit string');
	result.consumedBits = bits.position;
	result.structureComplete =
		!result.notes.length && bits.paddingOnly() && (bitLength === bytes.length * 8 || bits.position === bitLength);
	if (!result.structureComplete) result.notes.push('Unconsumed bits or nonzero padding remain in raw.');
	if (!result.profileSupported) result.notes.push('Excluded, unassigned or extended ACSE profile data retained.');
	result.notes.push('ACSE structure does not verify application messages, authentication or association state.');
	return result;
}
