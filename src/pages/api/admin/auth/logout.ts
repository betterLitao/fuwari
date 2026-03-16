import type { APIRoute } from "astro";
import { jsonOk } from "@/utils/admin/http";
import { clearAdminSessionCookie, isAdminAuthConfigured } from "@/utils/admin/auth";

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
