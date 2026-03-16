import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ASSETS_DIR = path.join(process.cwd(), "public", "imported-assets");

const SIYUAN_ASSET_RE = /!\[([^\]]*)\]\((assets\/[^)\s"]+)(?:\s+"[^"]*")?\)/g;

function getSiyuanConfig() {
	const apiUrl = import.meta.env.SIYUAN_API_URL?.trim();
	const apiToken = import.meta.env.SIYUAN_API_TOKEN?.trim();

	if (!apiUrl || !apiToken) {
		throw new Error("缺少 SIYUAN_API_URL 或 SIYUAN_API_TOKEN。");
	}

	return {
		apiUrl: apiUrl.replace(/\/+$/, ""),
		apiToken,
	};
}

function getBaseUrl() {
	return import.meta.env.BASE_URL?.replace(/\/+$/, "") || "";
}

async function downloadAsset(
	url: string,
	token: string,
	destPath: string,
): Promise<boolean> {
	const response = await fetch(url, {
		headers: { Authorization: `Token ${token}` },
	});

	if (!response.ok) {
		return false;
	}

	const buffer = new Uint8Array(await response.arrayBuffer());
	if (buffer.length === 0) {
		return false;
	}

	await mkdir(path.dirname(destPath), { recursive: true });
	await writeFile(destPath, buffer);
	return true;
}

export async function downloadAndRewriteAssets(
	markdown: string,
	slug: string,
): Promise<{ content: string; downloadedCount: number }> {
	const matches = [...markdown.matchAll(SIYUAN_ASSET_RE)];
	if (matches.length === 0) {
		return { content: markdown, downloadedCount: 0 };
	}

	const { apiUrl, apiToken } = getSiyuanConfig();
	const base = getBaseUrl();
	const targetDir = path.join(ASSETS_DIR, slug);
	let downloadedCount = 0;
	const replacements = new Map<string, string>();

	for (const match of matches) {
		const [fullMatch, alt, assetPath] = match;
		if (replacements.has(fullMatch)) {
			continue;
		}

		const filename = path.basename(assetPath);
		const downloadUrl = `${apiUrl}/${assetPath}`;
		const destPath = path.join(targetDir, filename);

		const ok = await downloadAsset(downloadUrl, apiToken, destPath);
		if (ok) {
			const localPath = `${base}/imported-assets/${slug}/${filename}`;
			replacements.set(fullMatch, `![${alt}](${localPath})`);
			downloadedCount++;
		}
	}

	let result = markdown;
	for (const [original, replacement] of replacements) {
		while (result.includes(original)) {
			result = result.replace(original, replacement);
		}
	}

	return { content: result, downloadedCount };
}
