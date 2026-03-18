const SYNC_START = "<!-- SYNC:START -->";
const SYNC_END = "<!-- SYNC:END -->";
const LOCAL_START = "<!-- LOCAL:START -->";
const LOCAL_END = "<!-- LOCAL:END -->";

type ProtectedBlockState = "managed" | "broken" | "absent";

export interface ProtectedBlockInspection {
	state: ProtectedBlockState;
	localContent: string;
}

function hasOrderedPair(content: string, start: string, end: string) {
	const startIndex = content.indexOf(start);
	const endIndex = content.indexOf(end);

	return {
		hasStart: startIndex >= 0,
		hasEnd: endIndex >= 0,
		isOrdered: startIndex >= 0 && endIndex > startIndex,
	};
}

function getBlockContent(content: string, start: string, end: string) {
	const startIndex = content.indexOf(start);
	const endIndex = content.indexOf(end);

	if (startIndex < 0 || endIndex <= startIndex) {
		return "";
	}

	return content
		.slice(startIndex + start.length, endIndex)
		.replace(/^\r?\n/, "")
		.replace(/\r?\n$/, "");
}

export function inspectProtectedBlocks(
	content: string,
): ProtectedBlockInspection {
	const syncPair = hasOrderedPair(content, SYNC_START, SYNC_END);
	const localPair = hasOrderedPair(content, LOCAL_START, LOCAL_END);

	if (syncPair.isOrdered && localPair.isOrdered) {
		return {
			state: "managed",
			localContent: getBlockContent(content, LOCAL_START, LOCAL_END),
		};
	}

	if (
		syncPair.hasStart ||
		syncPair.hasEnd ||
		localPair.hasStart ||
		localPair.hasEnd
	) {
		return {
			state: "broken",
			localContent: "",
		};
	}

	return {
		state: "absent",
		localContent: "",
	};
}

function escapeYamlString(value: string) {
	return JSON.stringify(value ?? "");
}

function escapeYamlStringArray(values: string[]) {
	return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

export function buildManagedDocument(input: {
	title: string;
	publishedAt: string;
	updatedAt?: string;
	description?: string;
	tags: string[];
	category: string;
	draft: boolean;
	slug: string;
	siyuanDocId: string;
	siyuanNotebook: string;
	siyuanNotebookId: string;
	siyuanPath: string;
	siyuanUpdated?: string;
	siyuanHash: string;
	syncContent: string;
	localContent?: string;
}) {
	const lines = [
		"---",
		`title: ${escapeYamlString(input.title)}`,
		`published: ${escapeYamlString(input.publishedAt)}`,
	];

	if (input.updatedAt) {
		lines.push(`updated: ${escapeYamlString(input.updatedAt)}`);
	}

	lines.push(
		`description: ${escapeYamlString(input.description ?? "")}`,
		'image: ""',
		`tags: ${escapeYamlStringArray(input.tags)}`,
		`category: ${escapeYamlString(input.category)}`,
		`draft: ${input.draft ? "true" : "false"}`,
		'lang: ""',
		'source: "siyuan"',
		`siyuanDocId: ${escapeYamlString(input.siyuanDocId)}`,
		`siyuanNotebook: ${escapeYamlString(input.siyuanNotebook)}`,
		`siyuanNotebookId: ${escapeYamlString(input.siyuanNotebookId)}`,
		`siyuanPath: ${escapeYamlString(input.siyuanPath)}`,
	);

	if (input.siyuanUpdated) {
		lines.push(`siyuanUpdated: ${escapeYamlString(input.siyuanUpdated)}`);
	}

	lines.push(
		`siyuanHash: ${escapeYamlString(input.siyuanHash)}`,
		'prevTitle: ""',
		'prevSlug: ""',
		'nextTitle: ""',
		'nextSlug: ""',
		"---",
		"",
		SYNC_START,
		input.syncContent.trim(),
		SYNC_END,
		"",
		LOCAL_START,
		(input.localContent ?? "").trim(),
		LOCAL_END,
		"",
	);

	return lines.join("\n");
}

export function mergeManagedDocument(input: {
	existingContent: string;
	title: string;
	publishedAt: string;
	updatedAt?: string;
	description?: string;
	tags: string[];
	category: string;
	draft: boolean;
	slug: string;
	siyuanDocId: string;
	siyuanNotebook: string;
	siyuanNotebookId: string;
	siyuanPath: string;
	siyuanUpdated?: string;
	siyuanHash: string;
	syncContent: string;
	defaultLocalContent?: string;
}) {
	const inspection = inspectProtectedBlocks(input.existingContent);

	return buildManagedDocument({
		...input,
		localContent:
			inspection.state === "managed"
				? inspection.localContent
				: (input.defaultLocalContent ?? ""),
	});
}
