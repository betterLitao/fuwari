import type { APIRoute } from "astro";
import {
	clearAdminSessionCookie,
	isAdminAuthConfigured,
} from "@/utils/admin/auth";
import { jsonOk } from "@/utils/admin/http";

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
	clearAdminSessionCookie(cookies);

	return jsonOk({
		session: {
			authenticated: false,
			username: "",
		},
		configured: isAdminAuthConfigured(),
	});
};
