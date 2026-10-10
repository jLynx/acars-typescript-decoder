import { fileURLToPath } from 'node:url';

export const sourceAlias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };
