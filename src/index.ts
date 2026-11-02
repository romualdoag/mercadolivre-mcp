#!/usr/bin/env node
/**
 * mercadolivre-mcp — busca e detalhe de produtos no Mercado Livre Brasil
 * via api.mercadolibre.com (uso pessoal, OAuth com refresh automático).
 *
 * Tools:
 * - search_products(q|product_identifier, ...): descoberta no catálogo.
 * - get_product(product_id): ficha do produto (atributos, variações).
 * - get_item(item_id): preço/detalhe de um anúncio (id do link).
 * - get_items(item_ids): vários anúncios (bulk, até 20).
 * - get_seller_items(seller_id, ...): anúncios ativos de um vendedor.
 * - get_own_items(status): anúncios da própria conta.
 *
 * Catálogo não tem preço — preço vive no anúncio. Nunca inventa números:
 * sem dados → erro explícito com isError.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { MlClient, configFromEnv } from "./ml.js";
import {
  browseCategory,
  getItem,
  getItemQuestions,
  getItems,
  getOwnItems,
  getProduct,
  getSellerItems,
  getSellerProfile,
  getTrends,
  searchProducts,
} from "./service.js";

const require = createRequire(import.meta.url);
const PKG_VERSION: string = require("../package.json").version ?? "0.0.0";

const server = new McpServer({ name: "mercadolivre-mcp", version: PKG_VERSION });

type TextResult = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};

function asText(obj: unknown): TextResult {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function asError(err: unknown): TextResult {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[mercadolivre-mcp] tool error: ${msg}`);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

let client: MlClient | null = null;
function ml(): MlClient {
  client ??= new MlClient(configFromEnv());
  return client;
}

function site(): string {
  return process.env.ML_SITE_ID ?? "MLB";
}

server.registerTool(
  "search_products",
  {
    title: "Buscar produtos no catálogo",
    description:
      "Descoberta de produtos no catálogo MLB por palavras-chave, GTIN " +
      "(product_identifier) ou domínio. Retorna ficha sem preço — para " +
      "preço use get_item com o id do anúncio.",
    inputSchema: {
      q: z.string().optional().describe("palavras-chave (ex. 'camiseta preta M')"),
      product_identifier: z.string().optional().describe("GTIN/EAN/UPC/ISBN"),
      domain_id: z.string().optional().describe("ex. MLB-CELLPHONES"),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      offset: z.coerce.number().int().min(0).default(0),
    },
  },
  async (args): Promise<TextResult> => {
    try {
      return asText(await searchProducts(ml(), site(), args));
    } catch (e) {
      return asError(e);
    }
  },
);

server.registerTool(
  "get_product",
  {
    title: "Ficha do produto",
    description:
      "Ficha completa de um produto de catálogo (atributos, fotos, variações).",
    inputSchema: {
      product_id: z.string().describe("id do produto (ex. MLB52753326)"),
    },
  },
  async ({ product_id }): Promise<TextResult> => {
    try {
      return asText(await getProduct(ml(), product_id));
    } catch (e) {
      return asError(e);
    }
  },
);

server.registerTool(
  "get_item",
  {
    title: "Preço do anúncio",
    description:
      "Preço e detalhe de um anúncio (id MLB do link do produto).",
    inputSchema: {
      item_id: z.string().describe("id do anúncio (ex. MLB4746731943)"),
    },
  },
  async ({ item_id }): Promise<TextResult> => {
    try {
      return asText(await getItem(ml(), item_id));
    } catch (e) {
      return asError(e);
    }
  },
);

server.registerTool(
  "get_items",
  {
    title: "Preços em lote",
    description: "Preço/detalhe de até 20 anúncios numa chamada.",
    inputSchema: {
      item_ids: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe("ids dos anúncios"),
    },
  },
  async ({ item_ids }): Promise<TextResult> => {
    try {
      return asText(await getItems(ml(), item_ids));
    } catch (e) {
      return asError(e);
    }
  },
);

server.registerTool(
  "get_seller_items",
  {
    title: "Anúncios do vendedor",
    description:
      "Anúncios ativos de um vendedor (com preço), por seller_id numérico.",
    inputSchema: {
      seller_id: z.coerce.number().int().describe("id numérico do vendedor"),
      limit: z.coerce.number().int().min(1).max(20).default(10),
      offset: z.coerce.number().int().min(0).default(0),
      status: z.string().default("active"),
    },
  },
  async (args): Promise<TextResult> => {
    try {
      return asText(await getSellerItems(ml(), args));
    } catch (e) {
      return asError(e);
    }
  },
);

server.registerTool(
  "get_own_items",
  {
    title: "Meus anúncios",
    description: "Lista os anúncios da própria conta (dona do token).",
    inputSchema: {
      status: z.string().default("active").describe("active, paused, closed..."),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    },
  },
  async (args): Promise<TextResult> => {
    try {
      return asText(await getOwnItems(ml(), args));
    } catch (e) {
      return asError(e);
    }
  },
);

server.registerTool(
  "get_seller_profile",
  {
    title: "Reputação do vendedor",
    description:
      "Perfil público do vendedor: nickname, nível, total de transações e " +
      "avaliações positivas. Para achar o seller_id, abra qualquer anúncio " +
      "dele com get_item.",
    inputSchema: {
      seller_id: z.coerce.number().int().describe("id numérico do vendedor"),
    },
  },
  async ({ seller_id }): Promise<TextResult> => {
    try {
      return asText(await getSellerProfile(ml(), seller_id));
    } catch (e) {
      return asError(e);
    }
  },
);

server.registerTool(
  "browse_category",
  {
    title: "Navegar categorias",
    description:
      "Árvore de categorias: caminho até a raiz, total de anúncios e " +
      "subcategorias. Ponto de partida: category_id de um anúncio.",
    inputSchema: {
      category_id: z.string().describe("id da categoria (ex. MLB1051)"),
    },
  },
  async ({ category_id }): Promise<TextResult> => {
    try {
      return asText(await browseCategory(ml(), category_id));
    } catch (e) {
      return asError(e);
    }
  },
);

server.registerTool(
  "get_trends",
  {
    title: "Termos em alta",
    description:
      "Termos mais buscados numa categoria (descoberta pública do que está quente).",
    inputSchema: {
      category_id: z.string().describe("id da categoria (ex. MLB1051)"),
    },
  },
  async ({ category_id }): Promise<TextResult> => {
    try {
      return asText(await getTrends(ml(), site(), category_id));
    } catch (e) {
      return asError(e);
    }
  },
);

server.registerTool(
  "get_item_questions",
  {
    title: "Perguntas do anúncio",
    description: "Perguntas e respostas públicas de um anúncio.",
    inputSchema: {
      item_id: z.string().describe("id do anúncio"),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    },
  },
  async ({ item_id, limit }): Promise<TextResult> => {
    try {
      return asText(await getItemQuestions(ml(), item_id, { limit }));
    } catch (e) {
      return asError(e);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(`[mercadolivre-mcp] fatal: ${String(e)}`);
  process.exit(1);
});
