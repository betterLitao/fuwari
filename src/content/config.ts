import { defineCollection, z } from "astro:content";

const compatibleDateSchema = z.preprocess((input) => {
	if (input instanceof Date) return input;
	if (typeof input === "string") {
		const raw = input.trim();
		if (!raw) return input;

		// Accept imported frontmatter like 2026/03/19 and normalize it.
		const normalized = raw.replace(/\//g, "-");
		const parsed = new Date(normalized);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return input;
}, z.date());

const postsCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		published: compatibleDateSchema,
		updated: compatibleDateSchema.optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.string().optional().nullable().default(""),
		lang: z.string().optional().default(""),
		slug: z.string().optional().default(""),
		source: z.string().optional().default(""),
		siyuanDocId: z.string().optional().default(""),
		siyuanNotebook: z.string().optional().default(""),
		siyuanNotebookId: z.string().optional().default(""),
		siyuanPath: z.string().optional().default(""),
		siyuanUpdated: z.string().optional().default(""),
		siyuanHash: z.string().optional().default(""),
		siyuanSyncStrategy: z
			.enum(["managed", "local_override"])
			.optional()
			.default("managed"),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});
const specCollection = defineCollection({
	schema: z.object({}),
});
export const collections = {
	posts: postsCollection,
	spec: specCollection,
};
