import type { APIRoute } from "astro";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";
import { readImportHistory } from "@/utils/admin/history";

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
