/// <reference types="astro/client" />
/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
	readonly SIYUAN_API_URL?: string;
	readonly SIYUAN_API_TOKEN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
