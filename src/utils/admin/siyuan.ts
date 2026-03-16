import type { ImportDocNode, ImportNotebookNode } from "@/types/admin";

interface RawNotebook {
	id: string;
	name: string;
	icon: string;
	sort: number;
	closed: boolean;
}

interface RawFileEntry {
	id: string;
	name: string;
	path: string;
	subFileCount: number;
}

interface RawDocMeta {
	id: string;
	box: string;
	path: string;
	hpath: string;
	content: string;
	tag: string;
	updated: string;
	hash: string;
}

interface SiyuanEnvelope<T> {
	code: number;
	msg: string;
	data: T;
}

function getSiyuanConfig() {
	const apiUrl = import.meta.env.SIYUAN_API_URL?.trim();
	const apiToken = import.meta.env.SIYUAN_API_TOKEN?.trim();

	if (!apiUrl || !apiToken) {
		throw new Error(
			"缺少思源配置，请设置 SIYUAN_API_URL 和 SIYUAN_API_TOKEN。",
		);
	}

	return {
		apiUrl: apiUrl.replace(/\/+$/, ""),
		apiToken,
	};
}

function escapeSqlValue(value: string) {
	return value.replaceAll("'", "''");
}

function formatSiyuanTimestamp(raw: string) {
	if (!/^\d{14}$/.test(raw)) {
		return raw;
	}

	return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(
		8,
		10,
	)}:${raw.slice(10, 12)}`;
}

function splitTags(raw: string) {
	if (!raw) {
		return [];
	}

	if (raw.includes("#")) {
		const matched = Array.from(raw.matchAll(/#([^#]+)#/g), (item) =>
			item[1].trim(),
		);
		if (matched.length > 0) {
			return matched.filter(Boolean);
		}
	}

	return raw
		.split(/[,\n]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

async function callSiyuan<T>(endpoint: string, body: Record<string, unknown>) {
	const { apiUrl, apiToken } = getSiyuanConfig();
	const response = await fetch(`${apiUrl}${endpoint}`, {
		method: "POST",
		headers: {
			Authorization: `Token ${apiToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		throw new Error(`思源接口请求失败：${response.status} ${response.statusText}`);
	}

	const payload = (await response.json()) as SiyuanEnvelope<T>;
	if (payload.code !== 0) {
		throw new Error(payload.msg || "思源接口返回异常。");
	}

	return payload.data;
}

export async function querySql<T>(stmt: string) {
	const rows = await callSiyuan<T[] | null>("/api/query/sql", { stmt });
	return rows ?? [];
}

export async function listNotebooks(): Promise<ImportNotebookNode[]> {
	const data = await callSiyuan<{ notebooks: RawNotebook[] }>(
		"/api/notebook/lsNotebooks",
		{},
	);

	return [...data.notebooks]
		.sort((left, right) => left.sort - right.sort)
		.map((notebook) => ({
			id: `notebook:${notebook.id}`,
			kind: "notebook",
			notebookId: notebook.id,
			notebookName: notebook.name,
			title: notebook.name,
			path: "/",
			hPath: "/",
			hasChildren: true,
			childrenLoaded: false,
			children: [],
		}));
}

async function getNotebookNameMap() {
	const notebooks = await listNotebooks();
	return new Map(
		notebooks.map((notebook) => [notebook.notebookId, notebook.notebookName]),
	);
}

async function getDocMetaMap(ids: string[]) {
	if (ids.length === 0) {
		return new Map<string, RawDocMeta>();
	}

	const stmt = `SELECT id, box, path, hpath, content, tag, updated, hash FROM blocks WHERE type = 'd' AND id IN (${ids
		.map((id) => `'${escapeSqlValue(id)}'`)
		.join(", ")})`;
	const rows = await querySql<RawDocMeta>(stmt);
	return new Map(rows.map((row) => [row.id, row]));
}

function toDocNode(input: {
	file: RawFileEntry;
	meta: RawDocMeta;
	notebookName: string;
	children?: ImportDocNode[];
	childrenLoaded?: boolean;
}): ImportDocNode {
	return {
		id: input.file.id,
		kind: "doc",
		notebookId: input.meta.box,
		notebookName: input.notebookName,
		title: input.meta.content || input.file.name.replace(/\.sy$/i, ""),
		path: input.file.path,
		hPath: input.meta.hpath || "/",
		updated: input.meta.updated,
		updatedLabel: formatSiyuanTimestamp(input.meta.updated),
		hash: input.meta.hash,
		tags: splitTags(input.meta.tag),
		hasChildren: input.file.subFileCount > 0,
		childCount: input.file.subFileCount,
		childrenLoaded: input.childrenLoaded ?? false,
		children: input.children ?? [],
		status: "new",
	};
}

export async function listDocTree(input: {
	notebookId: string;
	path?: string;
	recursive?: boolean;
}): Promise<ImportDocNode[]> {
	const [treeData, notebookNameMap] = await Promise.all([
		callSiyuan<{ box: string; files: RawFileEntry[]; path: string }>(
			"/api/filetree/listDocsByPath",
			{
				notebook: input.notebookId,
				path: input.path ?? "/",
			},
		),
		getNotebookNameMap(),
	]);

	const metaMap = await getDocMetaMap(treeData.files.map((file) => file.id));
	const notebookName =
		notebookNameMap.get(input.notebookId) ?? `notebook:${input.notebookId}`;

	return Promise.all(
		treeData.files.map(async (file) => {
			const meta = metaMap.get(file.id);
			if (!meta) {
				throw new Error(`未找到文档元数据：${file.id}`);
			}

			if (input.recursive && file.subFileCount > 0) {
				const children = await listDocTree({
					notebookId: input.notebookId,
					path: file.path,
					recursive: true,
				});

				return toDocNode({
					file,
					meta,
					notebookName,
					children,
					childrenLoaded: true,
				});
			}

			return toDocNode({
				file,
				meta,
				notebookName,
				childrenLoaded: file.subFileCount === 0,
			});
		}),
	);
}

export async function searchDocs(input: {
	keyword: string;
	notebookId?: string;
	limit?: number;
}): Promise<ImportDocNode[]> {
	const keyword = input.keyword.trim();
	if (!keyword) {
		return [];
	}

	const notebookNameMap = await getNotebookNameMap();
	const likeValue = escapeSqlValue(keyword);
	const notebookFilter = input.notebookId
		? `AND box = '${escapeSqlValue(input.notebookId)}'`
		: "";
	const limit = Math.min(Math.max(input.limit ?? 12, 1), 50);
	const stmt = `
		SELECT id, box, path, hpath, content, tag, updated, hash
		FROM blocks
		WHERE type = 'd'
			${notebookFilter}
			AND (
				hpath LIKE '%${likeValue}%'
				OR content LIKE '%${likeValue}%'
				OR tag LIKE '%${likeValue}%'
			)
		ORDER BY updated DESC
		LIMIT ${limit}
	`;
	const rows = await querySql<RawDocMeta>(stmt);

	return rows.map((row) => ({
		id: row.id,
		kind: "doc",
		notebookId: row.box,
		notebookName: notebookNameMap.get(row.box) ?? `notebook:${row.box}`,
		title: row.content,
		path: row.path,
		hPath: row.hpath,
		updated: row.updated,
		updatedLabel: formatSiyuanTimestamp(row.updated),
		hash: row.hash,
		tags: splitTags(row.tag),
		hasChildren: false,
		childCount: 0,
		childrenLoaded: true,
		children: [],
		status: "new",
	}));
}

export async function getDocsByIds(ids: string[]): Promise<ImportDocNode[]> {
	const [rows, notebookNameMap] = await Promise.all([
		getDocMetaMap(ids),
		getNotebookNameMap(),
	]);

	return ids
		.map((id) => rows.get(id))
		.filter((row): row is RawDocMeta => Boolean(row))
		.map((row) => ({
			id: row.id,
			kind: "doc",
			notebookId: row.box,
			notebookName: notebookNameMap.get(row.box) ?? `notebook:${row.box}`,
			title: row.content,
			path: row.path,
			hPath: row.hpath,
			updated: row.updated,
			updatedLabel: formatSiyuanTimestamp(row.updated),
			hash: row.hash,
			tags: splitTags(row.tag),
			hasChildren: false,
			childCount: 0,
			childrenLoaded: true,
			children: [],
			status: "new",
		}));
}

export async function exportDocMarkdown(docId: string) {
	return callSiyuan<{ content: string; hPath: string }>(
		"/api/export/exportMdContent",
		{ id: docId },
	);
}
