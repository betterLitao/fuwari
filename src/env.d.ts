/// <reference types="astro/client" />
/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
	readonly AUTO_PUBLISH_AFTER_IMPORT?: string;
	readonly SIYUAN_API_URL?: string;
	readonly SIYUAN_API_TOKEN?: string;
	readonly CPA_BASE_URL?: string;
	readonly CPA_API_KEY?: string;
	readonly CPA_MODEL?: string;
	readonly ADMIN_USERNAME?: string;
	readonly ADMIN_PASSWORD?: string;
	readonly ADMIN_SESSION_SECRET?: string;
	readonly PUBLISH_SERVICE_NAME?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
