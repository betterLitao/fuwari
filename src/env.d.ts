/// <reference types="astro/client" />
/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
	readonly SIYUAN_API_URL?: string;
	readonly SIYUAN_API_TOKEN?: string;
	readonly ADMIN_USERNAME?: string;
	readonly ADMIN_PASSWORD?: string;
	readonly ADMIN_SESSION_SECRET?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
