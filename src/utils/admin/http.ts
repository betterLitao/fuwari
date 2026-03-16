import type { ApiResponse } from "@/types/admin";

export function jsonOk<T>(data: T, init?: ResponseInit) {
	return Response.json(
		{
			ok: true,
			data,
		} satisfies ApiResponse<T>,
		init,
	);
}

export function jsonError(message: string, status = 500) {
	return Response.json(
		{
			ok: false,
			error: message,
		} satisfies ApiResponse<never>,
		{ status },
	);
}

export function getErrorMessage(error: unknown) {
	if (error instanceof Error) {
		return error.message;
	}

	return "请求失败，请稍后重试。";
}
