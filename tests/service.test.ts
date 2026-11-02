/** Offline: mapeamento, validação e erros de domínio com fetch stub. */
import { describe, expect, it } from "vitest";
import { MlClient, MlApiError } from "../src/ml.js";
import {
  getItem,
  getItems,
  getOwnItems,
  getProduct,
  getSellerItems,
  searchProducts,
} from "../src/service.js";

const CFG = {
  siteId: "MLB",
  clientId: "cid",
  clientSecret: "sec",
  refreshToken: "rt0",
  timeoutMs: 5000,
  useProxy: false,
  tokensPath: null,
};

const CATALOG_FIXTURE = {
  keywords: "camiseta preta",
  paging: { total: 6758, limit: 10, offset: 0 },
  results: [
    {
      id: "MLB52753326",
      name: "Camiseta Preta M",
      domain_id: "MLB-TSHIRTS",
      status: "active",
      parent_id: "MLB51919760",
      pictures: [{ url: "https://exemplo/1.jpg" }],
      attributes: [{ id: "BRAND", value_name: "Marca X" }],
    },
  ],
};

const PRODUCT_FIXTURE = {
  id: "MLB52753326",
  name: "Camiseta Preta M",
  status: "active",
  domain_id: "MLB-TSHIRTS",
  permalink: "https://exemplo/p",
  pictures: [{ url: "https://exemplo/1.jpg" }],
  parent_id: null,
  attributes: [{ id: "COLOR", value_name: "Preto" }],
  pickers: [
    {
      picker_name: "Cor",
      products: [{ product_id: "MLB1", picker_label: "Preto" }],
    },
  ],
};

const ITEM_FIXTURE = {
  id: "MLB4746731943",
  title: "Câmera Olympus",
  price: 5100,
  currency_id: "BRL",
  original_price: null,
  condition: "new",
  status: "active",
  permalink: "https://exemplo/1",
  thumbnail: "https://exemplo/1.jpg",
  category_id: "MLB123",
  listing_type_id: "gold_pro",
  available_quantity: 50,
  sold_quantity: 7,
  seller_id: 82413831,
  attributes: [{ id: "BRAND", value_name: "Olympus" }],
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(
  routes: Record<string, (url: string) => Response>,
): typeof fetch {
  return (async (input: unknown, _init?: unknown) => {
    const url = String(input);
    for (const [prefix, fn] of Object.entries(routes)) {
      if (url.includes(prefix)) return fn(url);
    }
    return jsonRes({ message: "not mocked" }, 500);
  }) as typeof fetch;
}

const TOKEN_ROUTE = {
  "oauth/token": () =>
    jsonRes({ access_token: "AT", refresh_token: "RT2", expires_in: 21600 }),
};

const baseRoutes = {
  ...TOKEN_ROUTE,
  "/products/search": () => jsonRes(CATALOG_FIXTURE),
  "/products/MLB52753326": () => jsonRes(PRODUCT_FIXTURE),
  "/items/MLB4746731943": () => jsonRes(ITEM_FIXTURE),
  "/items/bulk": () =>
    jsonRes([{ status_code: 200, id: "MLB4746731943", body: ITEM_FIXTURE }]),
  "/users/me": () => jsonRes({ id: 82413831 }),
  "/users/82413831/items/search": () =>
    jsonRes({
      seller_id: 82413831,
      paging: { total: 1 },
      results: ["MLB4746731943"],
    }),
};

describe("searchProducts (catálogo)", () => {
  it("mapeia hits e paginação", async () => {
    const c = new MlClient(CFG, stubFetch(baseRoutes));
    const r = await searchProducts(c, "MLB", { q: "camiseta preta" });
    expect(r.query).toBe("camiseta preta");
    expect(r.paging.total).toBe(6758);
    expect(r.truncated).toBe(true);
    expect(r.results[0]).toMatchObject({
      id: "MLB52753326",
      name: "Camiseta Preta M",
      thumbnail: "https://exemplo/1.jpg",
    });
  });

  it("exige q ou product_identifier", async () => {
    const c = new MlClient(CFG, stubFetch(baseRoutes));
    await expect(searchProducts(c, "MLB", {})).rejects.toThrow(
      /q ou product_identifier/,
    );
  });

  it("403 PolicyAgent vira mensagem de permissões funcionais", async () => {
    const c = new MlClient(
      CFG,
      stubFetch({
        ...TOKEN_ROUTE,
        "/products/search": () =>
          jsonRes(
            {
              code: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES",
              blocked_by: "PolicyAgent",
              status: 403,
            },
            403,
          ),
      }),
    );
    await expect(searchProducts(c, "MLB", { q: "x" })).rejects.toThrow(
      /permissões funcionais/,
    );
  });
});

describe("getProduct", () => {
  it("mapeia ficha e variações", async () => {
    const c = new MlClient(CFG, stubFetch(baseRoutes));
    const p = await getProduct(c, "MLB52753326");
    expect(p.name).toBe("Camiseta Preta M");
    expect(p.variations).toEqual([
      { picker: "Cor", options: [{ product_id: "MLB1", label: "Preto" }] },
    ]);
  });

  it("404 vira 'não encontrado'", async () => {
    const c = new MlClient(
      CFG,
      stubFetch({
        ...TOKEN_ROUTE,
        "/products/MLB9": () => jsonRes({ message: "not found" }, 404),
      }),
    );
    await expect(getProduct(c, "MLB9")).rejects.toThrow(/não encontrado/);
  });
});

describe("getItem / getItems", () => {
  it("mapeia preço e atributos", async () => {
    const c = new MlClient(CFG, stubFetch(baseRoutes));
    const d = await getItem(c, "MLB4746731943");
    expect(d.price).toBe(5100);
    expect(d.attributes).toEqual([{ id: "BRAND", value: "Olympus" }]);
  });

  it("id inválido falha antes da rede", async () => {
    const c = new MlClient(CFG, stubFetch(baseRoutes));
    await expect(getItem(c, "abc")).rejects.toThrow(/inválido/);
  });

  it("bulk mapeia ok/error por item", async () => {
    const c = new MlClient(CFG, stubFetch(baseRoutes));
    const r = await getItems(c, ["MLB4746731943"]);
    expect(r.count).toBe(1);
    expect(r.items[0].ok).toBe(true);
  });

  it("bulk vazio ou >20 falha local", async () => {
    const c = new MlClient(CFG, stubFetch(baseRoutes));
    await expect(getItems(c, [])).rejects.toThrow();
    await expect(getItems(c, Array(21).fill("MLB1"))).rejects.toThrow(/máximo/);
  });
});

describe("getSellerItems / getOwnItems", () => {
  it("resolve ids do vendedor em detalhes", async () => {
    const c = new MlClient(CFG, stubFetch(baseRoutes));
    const r = await getSellerItems(c, { seller_id: 82413831 });
    expect(r.seller_id).toBe(82413831);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].price).toBe(5100);
  });

  it("lista ids da própria conta", async () => {
    const c = new MlClient(CFG, stubFetch(baseRoutes));
    const r = await getOwnItems(c, {});
    expect(r.seller_id).toBe(82413831);
    expect(r.item_ids).toEqual(["MLB4746731943"]);
  });

  it("erro de rede vira MlApiError status 0 (unknown)", async () => {
    const c = new MlClient(CFG, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    const err = await searchProducts(c, "MLB", { q: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(MlApiError);
    expect(String(err.message)).toMatch(/unknown/);
  });
});
