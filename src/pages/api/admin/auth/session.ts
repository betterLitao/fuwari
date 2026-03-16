import type { APIRoute } from "astro";
import { jsonOk } from "@/utils/admin/http";
import { isAdminAuthConfigured } from "@/utils/admin/auth";

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
