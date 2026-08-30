import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";

const NEWSAPI_BASE = "https://newsapi.org/v2";
const USER_AGENT = "Indonesia-News-API3/2.0";

type NewsArticle = {
	source?: {
		id?: string | null;
		name?: string;
	};
	author?: string | null;
	title?: string;
	description?: string | null;
	url?: string;
	urlToImage?: string | null;
	publishedAt?: string;
	content?: string | null;
};

type NewsApiResponse = {
	status: string;
	totalResults?: number;
	articles?: NewsArticle[];
	code?: string;
	message?: string;
};

function cleanArticles(articles: NewsArticle[] = []) {
	return articles.map((article) => ({
		title: article.title ?? null,
		source: article.source?.name ?? null,
		sourceId: article.source?.id ?? null,
		author: article.author ?? null,
		publishedAt: article.publishedAt ?? null,
		description: article.description ?? null,
		url: article.url ?? null,
		urlToImage: article.urlToImage ?? null,
		content: article.content ?? null,
	}));
}

async function callNewsApi(apiUrl: URL) {
	const response = await fetch(apiUrl.toString(), {
		method: "GET",
		headers: {
			"X-Api-Key": env.NEWSAPI_KEY,
			"User-Agent": USER_AGENT,
			Accept: "application/json",
		},
	});

	const text = await response.text();

	if (!response.ok) {
		return {
			ok: false,
			status: response.status,
			error: text,
		};
	}

	let data: NewsApiResponse;

	try {
		data = JSON.parse(text) as NewsApiResponse;
	} catch {
		return {
			ok: false,
			status: 502,
			error: "NewsAPI returned invalid JSON.",
		};
	}

	return {
		ok: true,
		status: response.status,
		data,
	};
}

function createServer() {
	const server = new McpServer({
		name: "Indonesia News API3",
		version: "2.0.0",
	});

	/*
	 * TOOL 1
	 * Flexible search using /v2/everything
	 */
	server.registerTool(
		"search_news",
		{
			description:
				"Search recent news using NewsAPI Everything. Supports Boolean queries, exact phrases, date ranges, title/description/content filtering, source/domain filtering, publication-date sorting, and pagination. For latest or time-sensitive requests, prefer sort_by=publishedAt and use from_date/to_date when available. Do not assume language=id; leave language empty for Indonesian news unless a supported NewsAPI language code is explicitly requested.",

			inputSchema: {
				query: z
					.string()
					.min(1)
					.describe(
						'News query. Supports quoted phrases and Boolean operators such as AND, OR, NOT. Example: "rupiah" AND ("dolar" OR "USD" OR "kurs").',
					),

				search_in: z
					.string()
					.optional()
					.describe(
						"Fields to search, such as title, description, content, or comma-separated combinations such as title,description.",
					),

				sources: z
					.string()
					.optional()
					.describe(
						"Comma-separated NewsAPI source identifiers.",
					),

				domains: z
					.string()
					.optional()
					.describe(
						"Comma-separated publisher domains to include, for example antaranews.com,kompas.com,tempo.co.",
					),

				exclude_domains: z
					.string()
					.optional()
					.describe(
						"Comma-separated publisher domains to exclude.",
					),

				from_date: z
					.string()
					.optional()
					.describe(
						"Oldest publication date/time in ISO 8601 format.",
					),

				to_date: z
					.string()
					.optional()
					.describe(
						"Newest publication date/time in ISO 8601 format.",
					),

				language: z
					.string()
					.optional()
					.describe(
						"NewsAPI-supported language code. Leave empty to avoid filtering by language.",
					),

				sort_by: z
					.enum(["publishedAt", "relevancy", "popularity"])
					.optional()
					.describe(
						"Sort order. Use publishedAt for newest articles first.",
					),

				page_size: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Number of results, maximum 100."),

				page: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe("Pagination page number."),
			},

			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},

		async ({
			query,
			search_in,
			sources,
			domains,
			exclude_domains,
			from_date,
			to_date,
			language,
			sort_by = "publishedAt",
			page_size = 20,
			page = 1,
		}) => {
			const apiUrl = new URL(`${NEWSAPI_BASE}/everything`);

			apiUrl.searchParams.set("q", query);
			apiUrl.searchParams.set("sortBy", sort_by);
			apiUrl.searchParams.set("pageSize", String(page_size));
			apiUrl.searchParams.set("page", String(page));

			if (search_in) {
				apiUrl.searchParams.set("searchIn", search_in);
			}

			if (sources) {
				apiUrl.searchParams.set("sources", sources);
			}

			if (domains) {
				apiUrl.searchParams.set("domains", domains);
			}

			if (exclude_domains) {
				apiUrl.searchParams.set(
					"excludeDomains",
					exclude_domains,
				);
			}

			if (from_date) {
				apiUrl.searchParams.set("from", from_date);
			}

			if (to_date) {
				apiUrl.searchParams.set("to", to_date);
			}

			if (language) {
				apiUrl.searchParams.set("language", language);
			}

			const result = await callNewsApi(apiUrl);

			if (!result.ok) {
				return {
					content: [
						{
							type: "text",
							text: `NewsAPI error ${result.status}: ${result.error}`,
						},
					],
					isError: true,
				};
			}

			const articles = cleanArticles(
				result.data?.articles ?? [],
			);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								status: result.data?.status,
								query,
								totalResults:
									result.data?.totalResults ??
									articles.length,
								page,
								pageSize: page_size,
								sortBy: sort_by,
								articles,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	/*
	 * TOOL 2
	 * Latest Indonesia-oriented news using /v2/everything
	 */
	server.registerTool(
		"latest_indonesia_news",
		{
			description:
				"Get the latest Indonesia-related news using NewsAPI Everything, sorted by publication time. This is the preferred general sensor for recent Indonesian news. A more precise query can be supplied for topics such as rupiah, politics, infrastructure, food, energy, or technology.",

			inputSchema: {
				query: z
					.string()
					.optional()
					.describe(
						'Optional precise query. Example for rupiah: "rupiah" AND ("dolar" OR "USD" OR "nilai tukar" OR "kurs").',
					),

				domains: z
					.string()
					.optional()
					.describe(
						"Optional comma-separated Indonesian publisher domains.",
					),

				from_date: z
					.string()
					.optional()
					.describe(
						"Optional oldest publication date/time in ISO 8601.",
					),

				to_date: z
					.string()
					.optional()
					.describe(
						"Optional newest publication date/time in ISO 8601.",
					),

				page_size: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Number of results, maximum 100."),

				page: z
					.number()
					.int()
					.min(1)
					.optional(),
			},

			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},

		async ({
			query = "Indonesia",
			domains,
			from_date,
			to_date,
			page_size = 20,
			page = 1,
		}) => {
			const apiUrl = new URL(`${NEWSAPI_BASE}/everything`);

			apiUrl.searchParams.set("q", query);
			apiUrl.searchParams.set("sortBy", "publishedAt");
			apiUrl.searchParams.set(
				"pageSize",
				String(page_size),
			);
			apiUrl.searchParams.set("page", String(page));

			if (domains) {
				apiUrl.searchParams.set("domains", domains);
			}

			if (from_date) {
				apiUrl.searchParams.set("from", from_date);
			}

			if (to_date) {
				apiUrl.searchParams.set("to", to_date);
			}

			const result = await callNewsApi(apiUrl);

			if (!result.ok) {
				return {
					content: [
						{
							type: "text",
							text: `NewsAPI error ${result.status}: ${result.error}`,
						},
					],
					isError: true,
				};
			}

			const articles = cleanArticles(
				result.data?.articles ?? [],
			);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								status: result.data?.status,
								mode: "latest_indonesia_news",
								query,
								totalResults:
									result.data?.totalResults ??
									articles.length,
								page,
								pageSize: page_size,
								articles,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	/*
	 * TOOL 3
	 * Raw Top Headlines sensor
	 */
	server.registerTool(
		"top_headlines",
		{
			description:
				"Get NewsAPI Top Headlines as an additional headline sensor. This is supplementary to latest_indonesia_news. Country, category, sources, and query can be supplied when supported by NewsAPI.",

			inputSchema: {
				country: z
					.string()
					.optional()
					.describe(
						"Optional two-letter country code supported by NewsAPI.",
					),

				category: z
					.enum([
						"business",
						"entertainment",
						"general",
						"health",
						"science",
						"sports",
						"technology",
					])
					.optional(),

				sources: z.string().optional(),

				query: z.string().optional(),

				page_size: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional(),

				page: z
					.number()
					.int()
					.min(1)
					.optional(),
			},

			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},

		async ({
			country,
			category,
			sources,
			query,
			page_size = 20,
			page = 1,
		}) => {
			const apiUrl = new URL(
				`${NEWSAPI_BASE}/top-headlines`,
			);

			apiUrl.searchParams.set(
				"pageSize",
				String(page_size),
			);
			apiUrl.searchParams.set("page", String(page));

			if (country) {
				apiUrl.searchParams.set("country", country);
			}

			if (category) {
				apiUrl.searchParams.set(
					"category",
					category,
				);
			}

			if (sources) {
				apiUrl.searchParams.set("sources", sources);
			}

			if (query) {
				apiUrl.searchParams.set("q", query);
			}

			const result = await callNewsApi(apiUrl);

			if (!result.ok) {
				return {
					content: [
						{
							type: "text",
							text: `NewsAPI error ${result.status}: ${result.error}`,
						},
					],
					isError: true,
				};
			}

			const articles = cleanArticles(
				result.data?.articles ?? [],
			);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								status: result.data?.status,
								mode: "top_headlines",
								totalResults:
									result.data?.totalResults ??
									articles.length,
								page,
								pageSize: page_size,
								articles,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	return server;
}

export default {
	fetch(request, env, ctx) {
		return createMcpHandler(createServer)(
			request,
			env,
			ctx,
		);
	},
} satisfies ExportedHandler;
