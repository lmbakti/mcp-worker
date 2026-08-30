import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";

function createServer() {
	const server = new McpServer({
		name: "ARUNIKA News",
		version: "1.0.0",
	});

	server.registerTool(
		"search_news",
		{
			description:
				"Search recent news from NewsAPI by keyword. Use this for Indonesian and global news searches.",
			inputSchema: {
				query: z.string(),
				language: z.string().optional(),
				page_size: z.number().min(1).max(50).optional(),
			},
		},
		async ({ query, language = "id", page_size = 20 }) => {
			const apiUrl = new URL("https://newsapi.org/v2/everything");

			apiUrl.searchParams.set("q", query);
			apiUrl.searchParams.set("language", language);
			apiUrl.searchParams.set("pageSize", String(page_size));
			apiUrl.searchParams.set("sortBy", "publishedAt");

			const response = await fetch(apiUrl.toString(), {
				headers: {
					"X-Api-Key": env.NEWSAPI_KEY,
					"User-Agent": "ARUNIKA-News-MCP/1.0",
				},
			});

			if (!response.ok) {
				const errorText = await response.text();

				return {
					content: [
						{
							type: "text",
							text: `NewsAPI error ${response.status}: ${errorText}`,
						},
					],
				};
			}

			const data = (await response.json()) as {
				status: string;
				totalResults?: number;
				articles?: Array<{
					source?: { id?: string | null; name?: string };
					author?: string | null;
					title?: string;
					description?: string | null;
					url?: string;
					publishedAt?: string;
					content?: string | null;
				}>;
			};

			const articles = (data.articles ?? []).map((article) => ({
				title: article.title,
				source: article.source?.name,
				author: article.author,
				publishedAt: article.publishedAt,
				description: article.description,
				url: article.url,
				content: article.content,
			}));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								query,
								totalResults: data.totalResults ?? articles.length,
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

	server.registerTool(
		"latest_indonesia_news",
		{
			description: "Get the latest top headlines from Indonesia using NewsAPI.",
			inputSchema: {
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
				page_size: z.number().min(1).max(50).optional(),
			},
		},
		async ({ category, page_size = 20 }) => {
			const apiUrl = new URL("https://newsapi.org/v2/top-headlines");

			apiUrl.searchParams.set("country", "id");
			apiUrl.searchParams.set("pageSize", String(page_size));

			if (category) {
				apiUrl.searchParams.set("category", category);
			}

			const response = await fetch(apiUrl.toString(), {
				headers: {
					"X-Api-Key": env.NEWSAPI_KEY,
					"User-Agent": "ARUNIKA-News-MCP/1.0",
				},
			});

			if (!response.ok) {
				const errorText = await response.text();

				return {
					content: [
						{
							type: "text",
							text: `NewsAPI error ${response.status}: ${errorText}`,
						},
					],
				};
			}

			const data = await response.json();

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(data, null, 2),
					},
				],
			};
		},
	);

	return server;
}

export default {
	fetch(request, env, ctx) {
		return createMcpHandler(createServer)(request, env, ctx);
	},
} satisfies ExportedHandler;
