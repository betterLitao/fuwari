import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportDocNode, ImportStatus } from "@/types/admin";
import { inspectProtectedBlocks } from "./protected-blocks";

const POSTS_ROOT = path.join(process.cwd(), "src", "content", "posts");
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);

export interface LocalImportedPost {
	docId: string;
	filePath: string;
	relativePath: string;
	slug: string;
	title: string;
	hash: string;
	updated: string;
	protectedBlockState: ReturnType<typeof inspectProtectedBlocks>["state"];
	content: string;
}

export interface LocalImportIndex {
	byDocId: Map<string, LocalImportedPost>;
	byRelativePath: Map<string, LocalImportedPost>;
}

function normalizeRelativePath(filePath: string) {
	return path.relative(POSTS_ROOT, filePath).split(path.sep).join("/");
}

function getSlugFromRelativePath(relativePath: string) {
	const withoutExt = relativePath.replace(/\.(md|mdx)$/i, "");

	if (withoutExt.endsWith("/index")) {
		return withoutExt.slice(0, -"/index".length);
	}

	return withoutExt;
}

function parseFrontmatter(source: string) {
	const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return match?.[1] ?? "";
}

function readFrontmatterField(source: string, fieldName: string) {
	const frontmatter = parseFrontmatter(source);
	if (!frontmatter) {
		return "";
	}

	const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, "m");
	const match = frontmatter.match(regex);
	if (!match) {
		return "";
	}

	return match[1].trim().replace(/^['"]|['"]$/g, "");
}

async function walkMarkdownFiles(dirPath: string): Promise<string[]> {
	const entries = await readdir(dirPath, { withFileTypes: true });
	const result: string[] = [];

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);

		if (entry.isDirectory()) {
			result.push(...(await walkMarkdownFiles(fullPath)));
			continue;
		}

		if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			result.push(fullPath);
		}
	}

	return result;
}

export async function buildLocalImportIndex(): Promise<LocalImportIndex> {
	const files = await walkMarkdownFiles(POSTS_ROOT);
	const byDocId = new Map<string, LocalImportedPost>();
	const byRelativePath = new Map<string, LocalImportedPost>();

	for (const filePath of files) {
		const content = await readFile(filePath, "utf8");
		const docId = readFrontmatterField(content, "siyuanDocId");
		const relativePath = normalizeRelativePath(filePath);
		const record: LocalImportedPost = {
			docId,
			filePath,
			relativePath,
			slug: getSlugFromRelativePath(relativePath),
			title: readFrontmatterField(content, "title"),
			hash: readFrontmatterField(content, "siyuanHash"),
			updated: readFrontmatterField(content, "siyuanUpdated"),
			protectedBlockState: inspectProtectedBlocks(content).state,
			content,
		};

		if (docId) {
			byDocId.set(docId, record);
		}

		byRelativePath.set(relativePath, record);
	}

	return {
		byDocId,
		byRelativePath,
	};
}

export function resolveImportStatus(
	docId: string,
	hash: string,
	index: LocalImportIndex,
): ImportStatus {
	const existing = index.byDocId.get(docId);

	if (!existing) {
		return "new";
	}

	if (existing.protectedBlockState !== "managed") {
		return "conflict";
	}

	if (existing.hash === hash) {
		return "synced";
	}

	return "updated";
}

export function attachImportStatus(
	nodes: ImportDocNode[],
	index: LocalImportIndex,
): ImportDocNode[] {
	return nodes.map((node) => ({
		...node,
		status: resolveImportStatus(node.id, node.hash, index),
		children: attachImportStatus(node.children, index),
	}));
}
