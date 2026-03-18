import { getSecret } from "astro:env/server";

export function readServerEnv(name: string) {
	const value = getSecret(name)?.trim();
	return value ? value : undefined;
}
