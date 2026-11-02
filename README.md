# mercadolivre-mcp

MCP server (stdio, uso pessoal): busca e detalhe de produtos no Mercado
Livre Brasil via `api.mercadolibre.com`.

Tools: `search_products` (catálogo: keywords, GTIN ou domínio — sem preço),
`get_product` (ficha + variações), `get_item` / `get_items` (preço dos
anúncios da PRÓPRIA conta), `get_item_description` (texto do anúncio, vale
para terceiros), `get_seller_profile` (reputação/nível), `browse_category`
(árvore de categorias), `get_trends` (termos em alta), `get_item_questions`
(Q&A público), `get_own_items` (anúncios da própria conta, com detalhes).

> Limite real da API: preço e detalhe de anúncio existem só para a própria
> conta (token do dono) — terceiros dão 403 `access_denied`, e a busca
> pública `/sites/*/search` é bloqueada na borda (IP de datacenter).
> Fluxos típicos: `search_products` (descobre) → links → `get_item`;
> `get_own_items` (preços da sua conta).

## Pré-requisito: permissões funcionais do app

Só `users` vem ativo por padrão (dá acesso a `/users/me`). Todo o resto
retorna `403 PolicyAgent` até você ativar no
[DevCenter](https://developers.mercadolivre.com.br/devcenter) → seu app →
**permissões funcionais** → leitura (produtos/itens). Depois **reautorize**
o app (novo `code`), pois os grants mudam.

## Env

| Var | Obrigatória | Default | Descrição |
| --- | --- | --- | --- |
| `ML_CLIENT_ID` | sim | — | id do app no DevCenter |
| `ML_CLIENT_SECRET` | sim | — | secret do app |
| `ML_REFRESH_TOKEN` | sim | — | refresh do fluxo Authorization Code (`offline_access`) |
| `ML_SITE_ID` | não | `MLB` | site (MLB = Brasil) |
| `ML_TIMEOUT_MS` | não | `20000` | timeout por chamada |
| `ML_USE_PROXY=1` | não | direto | roteia via `DATAIMPULSE_PROXY_URL`/`ML_PROXY_URL` |
| `ML_TOKENS_PATH` | não | `<pkg>/.ml-tokens.json` | estado dos tokens |
| `ML_TOKENS_ENABLED=0` | não | arquivo ativo | desativa persistência (só memória) |
| `ML_LIVE=1` | não | — | ativa `tests/live.test.ts` |

Obter o primeiro `refresh_token`:

1. `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=SEU_ID&redirect_uri=SUA_URI`
2. Autorize → capture o `?code=...` no redirect.
3. Troque (única vez):
   `POST https://api.mercadolibre.com/oauth/token`
   `grant_type=authorization_code&client_id=…&client_secret=…&code=…&redirect_uri=…`

**Rotação:** o `refresh_token` é de uso único — a cada refresh o server
persiste o par novo em `.ml-tokens.json` (modo 600, gitignored). A cópia
no `.env` fica obsoleta após a primeira rotação; fonte da verdade passa a
ser o arquivo. `access_token` dura ~6h e é renovado sozinho (com retry
único em 401).

## Dev

```bash
npm install
npm test            # build + vitest (live pula sem ML_LIVE=1)
ML_LIVE=1 npm test  # inclui chamadas reais à API
npm run setup:hooks # pre-push: build + testes
```

Nota: `available_quantity` nos recursos públicos é **referencial**
(faixas), não estoque exato. Nunca inventamos números: sem dados a tool
retorna `isError` com a causa.
