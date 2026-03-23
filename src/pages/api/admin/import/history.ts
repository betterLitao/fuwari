import type { APIRoute } from "astro";
import {
	readImportHistory,
	removeImportHistoryEntry,
} from "@/utils/admin/history";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		return jsonOk({
			entries: await readImportHistory(),
		});
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};

export const DELETE: APIRoute = async ({ url }) => {
	const jobId = url.searchParams.get("jobId")?.trim();
	if (!jobId) {
		return jsonError("缺少 jobId 参数。", 400);
	}

	try {
		return jsonOk({
			entries: await removeImportHistoryEntry(jobId),
		});
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
