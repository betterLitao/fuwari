<script lang="ts">
	import type { AdminSessionResponse, ApiResponse } from "@/types/admin";

	export let nextPath = "/admin/import/";
	export let configured = true;
	export let defaultUsername = "admin";

	let username = defaultUsername;
	let password = "";
	let error = "";
	let loading = false;

	async function submitLogin() {
		if (!configured) {
			error = "管理员鉴权未配置，请先设置环境变量。";
			return;
		}

		error = "";
		loading = true;

		try {
			const response = await fetch("/api/admin/auth/login/", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					username,
					password,
				}),
			});
			const payload = (await response.json()) as ApiResponse<AdminSessionResponse>;
			if (!payload.ok) {
				throw new Error(payload.error);
			}

			window.location.href = nextPath || "/admin/import/";
		} catch (submitError) {
			error =
				submitError instanceof Error
					? submitError.message
					: "登录失败，请稍后重试。";
		} finally {
			loading = false;
		}
	}
</script>

<section class="min-h-[100dvh] bg-[#ece8de] px-4 py-8 text-[#171916] dark:bg-[#0f120f] dark:text-[#eef2ec] sm:px-6">
	<div class="mx-auto grid max-w-[1120px] gap-6 lg:grid-cols-[0.95fr_1.05fr]">
		<div class="rounded-[2.2rem] border border-[#d8d0c2] bg-[#f7f4eb] p-8 shadow-[0_28px_60px_-42px_rgba(20,24,20,0.4)] dark:border-[#253028] dark:bg-[#151916]">
			<div class="inline-flex rounded-full border border-[#d6d0c4] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#686155] dark:border-[#303934] dark:bg-[#131816] dark:text-[#b7c0b8]">
				Admin Access
			</div>
			<h1 class="mt-6 max-w-[11ch] text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
				先登录，再操作思源发布后台。
			</h1>
			<p class="mt-4 max-w-[46ch] text-sm leading-7 text-[#5f594e] dark:text-[#a6b0a7]">
				外网开放的后台必须收口。这里走服务端鉴权，登录成功后用 HttpOnly Cookie 维持会话，浏览器拿不到明文凭据。
			</p>
			<div class="mt-8 grid gap-3 sm:grid-cols-2">
				<div class="rounded-[1.4rem] border border-[#ddd6c9] bg-white p-4 dark:border-[#2a342d] dark:bg-[#121713]">
					<div class="text-[11px] uppercase tracking-[0.24em] text-[#7a7468] dark:text-[#8ea291]">受保护对象</div>
					<div class="mt-3 text-sm leading-7 text-[#615c52] dark:text-[#b3bdb4]">
						`/admin/*` 页面和 `/api/admin/*` 接口
					</div>
				</div>
				<div class="rounded-[1.4rem] border border-[#ddd6c9] bg-white p-4 dark:border-[#2a342d] dark:bg-[#121713]">
					<div class="text-[11px] uppercase tracking-[0.24em] text-[#7a7468] dark:text-[#8ea291]">会话方式</div>
					<div class="mt-3 text-sm leading-7 text-[#615c52] dark:text-[#b3bdb4]">
						HttpOnly Cookie，默认 7 天有效
					</div>
				</div>
			</div>
		</div>

		<div class="rounded-[2.2rem] border border-[#202620] bg-[#171a18] p-8 text-[#edf2ed] shadow-[0_28px_60px_-42px_rgba(10,14,10,0.8)]">
			<div class="flex items-center justify-between gap-4">
				<div>
					<div class="text-xs uppercase tracking-[0.3em] text-[#8ea291]">登录入口</div>
					<div class="mt-3 text-2xl font-semibold tracking-[-0.04em]">管理员认证</div>
				</div>
				<div class="rounded-full border border-white/10 px-3 py-1 text-xs text-[#cfd8cf]">
					{configured ? "已启用" : "未配置"}
				</div>
			</div>

			<form class="mt-8 space-y-4" on:submit|preventDefault={submitLogin}>
				<label class="grid gap-2">
					<span class="text-xs uppercase tracking-[0.24em] text-[#8ea291]">用户名</span>
					<input bind:value={username} class="rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-[#708070]" placeholder="admin" type="text" />
				</label>
				<label class="grid gap-2">
					<span class="text-xs uppercase tracking-[0.24em] text-[#8ea291]">密码</span>
					<input bind:value={password} class="rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-[#708070]" placeholder="请输入管理员密码" type="password" />
				</label>

				{#if error}
					<div class="rounded-[1.2rem] border border-[#60433d] bg-[#2a1d18] px-4 py-3 text-sm text-[#e0b0a0]">
						{error}
					</div>
				{/if}

				<button class="w-full rounded-[1.2rem] border border-[#3f775d] bg-[#3f775d] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#35654f] disabled:cursor-not-allowed disabled:opacity-60" disabled={loading || !configured} type="submit">
					{loading ? "登录中..." : "进入后台"}
				</button>
			</form>

			<div class="mt-6 rounded-[1.2rem] border border-white/10 bg-white/5 p-4 text-sm leading-7 text-[#b9c4ba]">
				<div>成功登录后将跳回：`{nextPath}`</div>
				<div class="mt-2">环境变量至少要配：`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`</div>
			</div>
		</div>
	</div>
</section>
