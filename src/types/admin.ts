export type ImportStatus = "new" | "synced" | "updated" | "conflict";

export type SyncMode = "sync" | "create_only" | "force_overwrite";

export type SlugPolicy = "stable" | "manual" | "title";

export interface ImportNotebookNode {
	id: string;
	kind: "notebook";
	notebookId: string;
	notebookName: string;
	title: string;
	path: "/";
	hPath: "/";
	hasChildren: true;
	childrenLoaded: boolean;
	children: ImportDocNode[];
}

export interface ImportDocNode {
	id: string;
	kind: "doc";
	notebookId: string;
	notebookName: string;
	title: string;
	path: string;
	hPath: string;
	updated: string;
	updatedLabel: string;
	hash: string;
	tags: string[];
	hasChildren: boolean;
	childCount: number;
	childrenLoaded: boolean;
	children: ImportDocNode[];
	status: ImportStatus;
}

export type ImportTreeNode = ImportNotebookNode | ImportDocNode;

export interface NotebooksResponse {
	notebooks: ImportNotebookNode[];
}

export interface TreeResponse {
	nodes: ImportDocNode[];
	path: string;
	recursive: boolean;
}

export interface SearchResponse {
	items: ImportDocNode[];
	keyword: string;
}

export interface ImportRequestMetadata {
	category: string;
	tags: string[];
	publishedAt: string;
	slug: string;
	slugPolicy: SlugPolicy;
	draft: boolean;
	localBlockNote: string;
	localContentOverride?: string;
}

export interface ImportFolderItem {
	notebookId: string;
	path: string;
	recursive: boolean;
}

export interface ImportJobRequest {
	dryRun: boolean;
	syncMode: SyncMode;
	docIds: string[];
	folders?: ImportFolderItem[];
	metadata: ImportRequestMetadata;
}

export interface ImportJobRecord {
	id: string;
	label: string;
	status: "queued" | "running" | "success" | "attention";
	detail: string;
	timestamp: string;
}

export interface ImportPreviewItem {
	docId: string;
	title: string;
	notebookName: string;
	hPath: string;
	status: ImportStatus;
	action: "create" | "skip" | "update" | "block";
	reason: string;
	targetPath: string;
	existingPath: string;
	suggestedSlug: string;
	updatedLabel: string;
	tags: string[];
}

export interface ImportJobResult {
	job: ImportJobRecord;
	items: ImportPreviewItem[];
	summary: {
		total: number;
		newCount: number;
		syncedCount: number;
		updatedCount: number;
		conflictCount: number;
	};
	writable: boolean;
}

export interface ImportLocalContentResponse {
	docId: string;
	exists: boolean;
	protectedState: "managed" | "broken" | "absent";
	localContent: string;
	message: string;
}

export interface ImportHistoryEntry {
	job: ImportJobRecord;
	items: ImportPreviewItem[];
	summary: ImportJobResult["summary"];
	dryRun: boolean;
	syncMode: SyncMode;
	createdAt: string;
}

export interface ImportHistoryResponse {
	entries: ImportHistoryEntry[];
}

export interface AdminSession {
	authenticated: boolean;
	username: string;
}

export interface AdminSessionResponse {
	session: AdminSession;
	configured: boolean;
}

export type ApiResponse<T> =
	| {
			ok: true;
			data: T;
	  }
	| {
			ok: false;
			error: string;
	  };
