import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImportHistoryEntry } from "@/types/admin";

const HISTORY_DIR = path.join(process.cwd(), ".runtime", "admin");
const HISTORY_FILE = path.join(HISTORY_DIR, "import-history.json");
const MAX_HISTORY_ENTRIES = 40;

async function ensureHistoryDir() {
	await mkdir(HISTORY_DIR, { recursive: true });
}

export async function readImportHistory(): Promise<ImportHistoryEntry[]> {
	try {
		const content = await readFile(HISTORY_FILE, "utf8");
		const parsed = JSON.parse(content) as ImportHistoryEntry[];
		return Array.isArray(parsed) ? parsed : [];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}

		throw error;
	}
}

export async function appendImportHistory(entry: ImportHistoryEntry) {
	await ensureHistoryDir();
	const current = await readImportHistory();
	const next = [entry, ...current].slice(0, MAX_HISTORY_ENTRIES);
	await writeFile(HISTORY_FILE, JSON.stringify(next, null, 2), "utf8");
	return next;
}
