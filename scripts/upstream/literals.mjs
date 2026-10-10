import ts from 'typescript';

export const unresolved = Symbol('unresolved');
export const undefinedLiteral = { $undefined: true };

/** Read syntax as data. Never evaluate source code, calls, getters or substitutions. */
export function literal(node, variables = {}) {
	if (!node) return unresolved;
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (node.kind === ts.SyntaxKind.NullKeyword) return null;
	if (ts.isIdentifier(node))
		return node.text === 'undefined'
			? undefinedLiteral
			: Object.hasOwn(variables, node.text)
				? variables[node.text]
				: unresolved;
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return literal(node.expression, variables);
	if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
		const value = literal(node.operand, variables);
		return typeof value === 'number' ? -value : unresolved;
	}
	if (ts.isBinaryExpression(node)) {
		const left = literal(node.left, variables);
		const right = literal(node.right, variables);
		if (node.operatorToken.kind === ts.SyntaxKind.PlusToken && typeof left === 'string' && typeof right === 'string')
			return left + right;
		if (typeof left === 'number' && typeof right === 'number') {
			if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
			if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
		}
	}
	if (ts.isArrayLiteralExpression(node)) {
		const values = node.elements.map((item) => literal(item, variables));
		return values.includes(unresolved) ? unresolved : values;
	}
	if (ts.isObjectLiteralExpression(node)) {
		const value = {};
		for (const member of node.properties) {
			if (!ts.isPropertyAssignment(member)) return unresolved;
			const key = ts.isIdentifier(member.name) ? member.name.text : literal(member.name);
			const item = literal(member.initializer, variables);
			if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || item === unresolved)
				return unresolved;
			value[key] = item;
		}
		return value;
	}
	if (ts.isPropertyAccessExpression(node)) {
		const value = literal(node.expression, variables);
		if (value && typeof value === 'object' && Object.hasOwn(value, node.name.text)) return value[node.name.text];
	}
	if (
		ts.isCallExpression(node) &&
		ts.isPropertyAccessExpression(node.expression) &&
		node.expression.name.text === 'substring'
	) {
		const value = literal(node.expression.expression, variables);
		const args = node.arguments.map((argument) => literal(argument, variables));
		if (typeof value === 'string' && args.length <= 2 && args.every((argument) => typeof argument === 'number'))
			return value.substring(...args);
	}
	return unresolved;
}

export function accessPath(node) {
	if (ts.isIdentifier(node)) return [node.text];
	if (ts.isPropertyAccessExpression(node)) {
		const parent = accessPath(node.expression);
		return parent && [...parent, node.name.text];
	}
	if (ts.isElementAccessExpression(node)) {
		const parent = accessPath(node.expression);
		const index = literal(node.argumentExpression);
		return parent && typeof index === 'number' ? [...parent, index] : undefined;
	}
}
