import type { APIRoute } from "astro";
import { isAdminAuthConfigured } from "@/utils/admin/auth";
import { jsonOk } from "@/utils/admin/http";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	const adminLocals = locals as typeof locals & {
		admin: {
			authenticated: boolean;
			username: string;
		};
	};

	return jsonOk({
		session: {
			authenticated: adminLocals.admin.authenticated,
			username: adminLocals.admin.username,
		},
		configured: isAdminAuthConfigured(),
	});
};
