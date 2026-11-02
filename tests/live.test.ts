/**
 * Live (opt-in): exige credenciais reais + permissões funcionais no app.
 * Roda só com ML_LIVE=1 — `npm test` padrão pula este arquivo.
 */
import { describe, expect, it } from "vitest";
import { MlClient, configFromEnv } from "../src/ml.js";
import { browseCategory, getItem, getItemDescription, getItemQuestions, getOwnItems, getProduct, getSellerProfile, getTrends, searchProducts } from "../src/service.js";

const LIVE = process.env.ML_LIVE === "1";

describe.skipIf(!LIVE)("live api.mercadolibre.com", () => {
  it("users/me retorna o dono do token", async () => {
    const c = new MlClient(configFromEnv());
    const me = await c.get<{ id: number; nickname: string }>("/users/me");
    expect(me.id).toBeGreaterThan(0);
  }, 60_000);

  it("search de catálogo retorna produtos", async () => {
    const c = new MlClient(configFromEnv());
    const r = await searchProducts(c, process.env.ML_SITE_ID ?? "MLB", {
      q: "camiseta preta",
      limit: 3,
    });
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].id).toMatch(/^[A-Z]{3}\d+$/);
    expect(r.results[0].name.length).toBeGreaterThan(0);
  }, 60_000);

  it("getProduct + getItem encadeiam (catálogo → anúncio)", async () => {
    const c = new MlClient(configFromEnv());
    const r = await searchProducts(c, process.env.ML_SITE_ID ?? "MLB", {
      q: "olympus e-m10",
      limit: 2,
    });
    const p = await getProduct(c, r.results[0].id);
    expect(p.name.length).toBeGreaterThan(0);
    const d = await getItem(c, "MLB4746731943");
    expect(d.price).toBeGreaterThan(0);
  }, 60_000);

  it("getOwnItems lista a conta", async () => {
    const c = new MlClient(configFromEnv());
    const r = await getOwnItems(c, { limit: 5 });
    expect(r.seller_id).toBeGreaterThan(0);
    expect(r.items.length).toBeGreaterThan(0);
  }, 60_000);

  it("descrição: própria conta e terceiro", async () => {
    const c = new MlClient(configFromEnv());
    const own = await getItemDescription(c, "MLB4746731943");
    expect(typeof own.plain_text).toBe("string");
    const third = await getItemDescription(c, "MLB3975661273");
    expect(typeof third.plain_text).toBe("string");
  }, 60_000);

  it("fluxo público: trends → categoria → perfil → perguntas", async () => {
    const c = new MlClient(configFromEnv());
    const site = process.env.ML_SITE_ID ?? "MLB";
    const t = await getTrends(c, site, "MLB1051");
    expect(t.count).toBeGreaterThan(0);
    const n = await browseCategory(c, "MLB1051");
    expect(n.children.length).toBeGreaterThan(0);
    const d = await getItem(c, "MLB4746731943");
    const p = await getSellerProfile(c, d.seller_id!);
    expect(p.nickname.length).toBeGreaterThan(0);
    const q = await getItemQuestions(c, "MLB4746731943", { limit: 3 });
    expect(q.total).toBeGreaterThanOrEqual(0);
  }, 90_000);
});
