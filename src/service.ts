/**
 * service.ts — lógica pura das tools (sem imports do SDK MCP).
 *
 * Descoberta: catálogo (/products/search, /products/{id}) — funciona com
 * grants de leitura. Preço de anúncio: /items (por id de link) e
 * /users/{id}/items/search (vendedor). A busca pública por site (/sites)
 * é bloqueada na borda para este app — NÃO usar (ver README).
 */
import { MlApiError, MlClient } from "./ml.js";

export const ENTITY_ID_RE = /^[A-Z]{3}\d+$/;
const MAX_BULK = 20;

function checkId(id: string, label: string): string {
  const norm = id.trim().toUpperCase();
  if (!ENTITY_ID_RE.test(norm))
    throw new Error(`${label} inválido: ${id} (esperado ex. MLB1234567890)`);
  return norm;
}

export interface CatalogHit {
  id: string;
  name: string;
  domain_id: string;
  status: string;
  permalink: string;
  thumbnail: string;
  parent_id: string | null;
  attributes: { id: string; value: string | null }[];
}

export interface CatalogSearchResult {
  query: string | null;
  site: string;
  paging: { total: number; limit: number; offset: number };
  truncated: boolean;
  results: CatalogHit[];
}

export interface ProductDetail {
  id: string;
  name: string;
  status: string;
  domain_id: string;
  permalink: string;
  thumbnail: string;
  parent_id: string | null;
  attributes: { id: string; value: string | null }[];
  variations: { picker: string; options: { product_id: string; label: string }[] }[];
}

export interface ItemDetail {
  id: string;
  title: string;
  price: number;
  currency_id: string;
  original_price: number | null;
  condition: string;
  status: string;
  permalink: string;
  thumbnail: string;
  category_id: string;
  listing_type_id: string;
  available_quantity: unknown;
  sold_quantity: number | null;
  seller_id: number | null;
  attributes: { id: string; value: string | null }[];
}

export interface BulkItem {
  id: string;
  ok: boolean;
  item?: ItemDetail;
  error?: string;
}

function attrsOf(b: Record<string, unknown>): { id: string; value: string | null }[] {
  if (!Array.isArray(b.attributes)) return [];
  return (b.attributes as Record<string, unknown>[]).map((a) => ({
    id: String(a.id ?? ""),
    value:
      typeof a.value_name === "string"
        ? a.value_name
        : typeof a.value_id === "string"
          ? a.value_id
          : null,
  }));
}

function thumbOf(b: Record<string, unknown>): string {
  const pics = b.pictures;
  if (Array.isArray(pics) && pics.length > 0)
    return String((pics[0] as Record<string, unknown>).url ?? "");
  return "";
}

function catalogHitOf(r: Record<string, unknown>): CatalogHit {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    domain_id: String(r.domain_id ?? ""),
    status: String(r.status ?? ""),
    permalink: typeof r.permalink === "string" ? r.permalink : "",
    thumbnail: thumbOf(r),
    parent_id: typeof r.parent_id === "string" ? r.parent_id : null,
    attributes: attrsOf(r),
  };
}

function detailOf(b: Record<string, unknown>): ItemDetail {
  return {
    id: String(b.id ?? ""),
    title: String(b.title ?? ""),
    price: typeof b.price === "number" ? b.price : NaN,
    currency_id: String(b.currency_id ?? ""),
    original_price:
      typeof b.original_price === "number" ? b.original_price : null,
    condition: String(b.condition ?? ""),
    status: String(b.status ?? ""),
    permalink: String(b.permalink ?? ""),
    thumbnail: String(b.thumbnail ?? ""),
    category_id: String(b.category_id ?? ""),
    listing_type_id: String(b.listing_type_id ?? ""),
    available_quantity: b.available_quantity ?? null,
    sold_quantity: typeof b.sold_quantity === "number" ? b.sold_quantity : null,
    seller_id: typeof b.seller_id === "number" ? b.seller_id : null,
    attributes: attrsOf(b),
  };
}

export interface CatalogSearchOpts {
  q?: string;
  product_identifier?: string;
  domain_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Descoberta de produtos no catálogo (nomes, atributos, fotos, variações).
 * Sem preço — preço vive no anúncio: use get_item(s) com o id do link.
 */
export async function searchProducts(
  client: MlClient,
  site: string,
  opts: CatalogSearchOpts,
): Promise<CatalogSearchResult> {
  if (!opts.q && !opts.product_identifier)
    throw new Error("informe q ou product_identifier");
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const raw = await client.get<{
    keywords?: string;
    paging?: { total: number; limit: number; offset: number };
    results?: Record<string, unknown>[];
  }>("/products/search", {
    status: "active",
    site_id: site,
    q: opts.q,
    product_identifier: opts.product_identifier,
    domain_id: opts.domain_id,
    limit,
    offset: opts.offset ?? 0,
  });
  const results = (raw.results ?? []).map(catalogHitOf);
  const total = raw.paging?.total ?? results.length;
  return {
    query: raw.keywords ?? opts.q ?? null,
    site,
    paging: {
      total,
      limit: raw.paging?.limit ?? limit,
      offset: raw.paging?.offset ?? 0,
    },
    truncated: total > results.length,
    results,
  };
}

/** Ficha de um produto de catálogo (atributos + variações). */
export async function getProduct(
  client: MlClient,
  productId: string,
): Promise<ProductDetail> {
  const id = checkId(productId, "product_id");
  try {
    const b = await client.get<Record<string, unknown>>(`/products/${id}`);
    const pickers = Array.isArray(b.pickers)
      ? (b.pickers as Record<string, unknown>[]).map((p) => ({
          picker: String(p.picker_name ?? p.picker_id ?? ""),
          options: Array.isArray(p.products)
            ? (p.products as Record<string, unknown>[]).map((o) => ({
                product_id: String(o.product_id ?? ""),
                label: String(o.picker_label ?? o.product_name ?? ""),
              }))
            : [],
        }))
      : [];
    return {
      id: String(b.id ?? id),
      name: String(b.name ?? ""),
      status: String(b.status ?? ""),
      domain_id: String(b.domain_id ?? ""),
      permalink: typeof b.permalink === "string" ? b.permalink : "",
      thumbnail: thumbOf(b),
      parent_id: typeof b.parent_id === "string" ? b.parent_id : null,
      attributes: attrsOf(b),
      variations: pickers,
    };
  } catch (e) {
    if (e instanceof MlApiError && e.status === 404)
      throw new Error(`produto de catálogo não encontrado: ${id}`);
    throw e;
  }
}

/** Detalhe de um anúncio (preço). 404 vira erro de domínio. */
export async function getItem(
  client: MlClient,
  itemId: string,
): Promise<ItemDetail> {
  const id = checkId(itemId, "item_id");
  try {
    const raw = await client.get<Record<string, unknown>>(`/items/${id}`);
    return detailOf(raw);
  } catch (e) {
    if (e instanceof MlApiError && e.status === 404)
      throw new Error(`anúncio não encontrado: ${id}`);
    throw e;
  }
}

/** Vários anúncios numa chamada (endpoint /items/bulk). */
export async function getItems(
  client: MlClient,
  itemIds: string[],
): Promise<{ count: number; items: BulkItem[] }> {
  const ids = itemIds.map((i) => checkId(i, "item_id"));
  if (ids.length === 0) throw new Error("item_ids must not be empty");
  if (ids.length > MAX_BULK)
    throw new Error(`máximo de ${MAX_BULK} ids por chamada`);
  const raw = await client.get<
    { status_code: number; id?: string; body?: Record<string, unknown> }[]
  >("/items/bulk", {
    ids: ids.join(","),
    attributes:
      "body.id,body.title,body.price,body.currency_id,body.original_price,body.condition,body.status,body.permalink,body.thumbnail,body.category_id,body.listing_type_id,body.available_quantity,body.sold_quantity,body.seller_id,body.attributes",
  });
  return {
    count: raw.length,
    items: raw.map((e) => {
      const id = String(e.id ?? "");
      if (e.status_code !== 200 || !e.body)
        return { id, ok: false as const, error: `ML ${e.status_code}` };
      return { id, ok: true as const, item: detailOf(e.body) };
    }),
  };
}

export interface SellerItemsResult {
  seller_id: number;
  paging: { total: number };
  truncated: boolean;
  items: ItemDetail[];
}

/** Anúncios ativos de um vendedor, já com detalhes (via bulk). */
export async function getSellerItems(
  client: MlClient,
  opts: { seller_id: number; limit?: number; offset?: number; status?: string },
): Promise<SellerItemsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), MAX_BULK);
  const list = await client.get<{
    paging?: { total: number };
    results?: string[];
  }>(`/users/${opts.seller_id}/items/search`, {
    status: opts.status ?? "active",
    limit,
    offset: opts.offset ?? 0,
  });
  const ids = list.results ?? [];
  const total = list.paging?.total ?? ids.length;
  if (ids.length === 0)
    return { seller_id: opts.seller_id, paging: { total }, truncated: total > 0, items: [] };
  const bulk = await getItems(client, ids);
  return {
    seller_id: opts.seller_id,
    paging: { total },
    truncated: total > ids.length,
    items: bulk.items.flatMap((i) => (i.ok && i.item ? [i.item] : [])),
  };
}

/** Anúncios da própria conta (token owner). */
export async function getOwnItems(
  client: MlClient,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ seller_id: number; paging: { total: number }; item_ids: string[] }> {
  const me = await client.ownUserId();
  const raw = await client.get<{
    paging?: { total: number };
    results?: string[];
  }>(`/users/${me}/items/search`, {
    status: opts.status ?? "active",
    limit: Math.min(Math.max(opts.limit ?? 50, 1), 100),
    offset: opts.offset ?? 0,
  });
  return {
    seller_id: me,
    paging: { total: raw.paging?.total ?? (raw.results ?? []).length },
    item_ids: raw.results ?? [],
  };
}
