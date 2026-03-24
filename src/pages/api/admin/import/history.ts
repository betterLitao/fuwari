import type { APIRoute } from "astro";
import {
	readImportHistory,
	removeImportHistoryEntry,
} from "@/utils/admin/history";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";

export const prerender = false;

async function readJobId(request: Request, url: URL) {
	const queryJobId = url.searchParams.get("jobId")?.trim();
	if (queryJobId) {
		return queryJobId;
	}

	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return "";
	}

	try {
		const payload = (await request.json()) as { jobId?: unknown };
		return typeof payload.jobId === "string" ? payload.jobId.trim() : "";
	} catch {
		return "";
	}
}

export const GET: APIRoute = async () => {
	try {
		return jsonOk({
			entries: await readImportHistory(),
		});
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};

export const DELETE: APIRoute = async ({ request, url }) => {
	const jobId = await readJobId(request, url);
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
