import type { XmlNode } from './types';

/** Bounded XML subset for observed RTR reports. No DTD, external entities, namespaces or processing instructions. */
export function readReportXml(text: string): XmlNode | undefined {
	if (!validDocumentInput(text)) return;
	const stack: XmlNode[] = [];
	let root: XmlNode | undefined,
		position = 0,
		count = 0;
	try {
		while (position < text.length) {
			if (text[position] !== '<') {
				position = appendText(text, position, stack);
				continue;
			}
			const closing = /^<\/([A-Za-z_][A-Za-z0-9_.-]*)\s*>/.exec(text.slice(position));
			if (closing) {
				if (stack.pop()?.name !== closing[1]) return;
				position += closing[0].length;
				continue;
			}
			const tag = /^<([A-Za-z_][A-Za-z0-9_.-]*)(?=[\s/>])/.exec(text.slice(position));
			if (!tag || ++count > 256 || stack.length >= 16) return;
			const node: XmlNode = {
				name: tag[1],
				attributes: Object.create(null) as Record<string, string>,
				text: '',
				children: [],
			};
			position += tag[0].length;
			position = attributes(text, position, node);
			const empty = text.startsWith('/>', position);
			if (!empty && text[position] !== '>') return;
			position += empty ? 2 : 1;
			if (stack.length) stack.at(-1)!.children.push(node);
			else if (root) return;
			else root = node;
			if (!empty) stack.push(node);
		}
		return !stack.length && root?.name === 'RTR' ? root : undefined;
	} catch {
		return;
	}
}
function validDocumentInput(text: string): boolean {
	return (
		typeof text === 'string' &&
		text.length <= 8192 &&
		text.trimStart().startsWith('<RTR') &&
		![...text].some((char) => !validCharacter(char.codePointAt(0)!))
	);
}
function appendText(text: string, position: number, stack: XmlNode[]): number {
	const next = text.indexOf('<', position),
		end = next < 0 ? text.length : next;
	const value = entities(text.slice(position, end));
	if (stack.length) stack.at(-1)!.text += value;
	else if (value.trim()) throw new Error('Text outside XML root');
	return end;
}
function validCharacter(value: number): boolean {
	return (
		[9, 10, 13].includes(value) ||
		(value >= 32 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) && ![0xfffe, 0xffff].includes(value))
	);
}
function attributes(text: string, start: number, node: XmlNode): number {
	let position = start;
	while (true) {
		const whitespace = /^\s*/.exec(text.slice(position))![0];
		position += whitespace.length;
		if (text[position] === '>' || text.startsWith('/>', position)) return position;
		if (!whitespace) throw new Error('Attribute separation required');
		const match = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(text.slice(position));
		if (!match || match[1] === 'xmlns' || Object.hasOwn(node.attributes, match[1]))
			throw new Error('Invalid XML attribute');
		node.attributes[match[1]] = entities(match[2] ?? match[3]);
		position += match[0].length;
	}
}
function entities(text: string): string {
	if (text.includes(']]>')) throw new Error('Invalid XML text');
	return text.replace(/&([^;\s&]*);|&/g, (_, entity: string | undefined) => {
		const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };
		if (entity && Object.hasOwn(named, entity)) return named[entity];
		if (!entity || !/^(?:#\d+|#x[0-9a-fA-F]+)$/.test(entity)) throw new Error('Unsupported XML entity');
		const value = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
		if (!validCharacter(value)) throw new Error('Invalid XML character');
		return String.fromCodePoint(value);
	});
}
