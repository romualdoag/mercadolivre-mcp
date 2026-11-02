#!/usr/bin/env bash
# Registra o mercadolivre-mcp local no Hermes (~/.hermes/config.yaml).
# - Backup com timestamp antes de tocar em qualquer coisa.
# - Idempotente: pode rodar quantas vezes quiser.
# - Renomeia o MCP remoto (docs/devsite) para `mercadolivre-devsite`
#   e adiciona o bloco stdio local como `mercadolivre`.
# Uso: bash scripts/register-hermes.sh
set -eu

CFG="$HOME/.hermes/config.yaml"
[ -f "$CFG" ] || { echo "ERRO: $CFG não existe"; exit 1; }

BACKUP="$CFG.bak-$(date +%Y%m%dT%H%M%S)"
cp "$CFG" "$BACKUP"
echo "backup: $BACKUP"

python3 - <<'EOF'
import os, re

cfg = os.path.expanduser("~/.hermes/config.yaml")
src = open(cfg, encoding="utf-8").read()
orig = src

# 1. Renomeia o remoto (docs) para liberar o nome `mercadolivre`.
src, n1 = re.subn(
    r"^  mercadolivre:\n    url: https://mcp\.mercadolibre\.com/devsite/v1/mcp",
    "  mercadolivre-devsite:\n    url: https://mcp.mercadolibre.com/devsite/v1/mcp",
    src, count=1, flags=re.M,
)

# 2. Adiciona o bloco stdio local após o keepa (se ainda não existir).
has_local = re.search(r"^  mercadolivre:\n    command: node", src, flags=re.M)
n2 = 0
if not has_local:
    block = (
        "  mercadolivre:\n"
        "    command: node\n"
        "    args:\n"
        "      - /home/hermes/github/mercadolivre-mcp/dist/index.js\n"
        "    enabled: true\n"
        "    env:\n"
        "      ML_SITE_ID: ${ML_SITE_ID}\n"
        "      ML_CLIENT_ID: ${ML_CLIENT_ID}\n"
        "      ML_CLIENT_SECRET: ${ML_CLIENT_SECRET}\n"
        "      ML_REFRESH_TOKEN: ${ML_REFRESH_TOKEN}\n"
    )
    anchor = (
        "  keepa:\n"
        "    command: node\n"
        "    args:\n"
        "      - /home/hermes/github/keepa-mcp/dist/index.js\n"
        "    enabled: true\n"
    )
    if anchor not in src:
        raise SystemExit("ERRO: bloco do keepa não encontrado — config mudou?")
    src = src.replace(anchor, anchor + block, 1)
    n2 = 1

if src != orig:
    open(cfg, "w", encoding="utf-8").write(src)
print(f"rename-remoto={n1} insert-local={n2} (0 = já estava ok)")
EOF

# 3. Valida o YAML (se pyyaml existir) e checa pré-requisitos.
python3 - <<'EOF'
try:
    import yaml
    d = yaml.safe_load(open("/home/hermes/.hermes/config.yaml", encoding="utf-8"))
    ml = d["mcp_servers"]["mercadolivre"] if "mcp_servers" in d else d.get("mercadolivre")
    print("yaml: OK")
except ImportError:
    print("yaml: pyyaml ausente, pulei validação estrutural")
except Exception as e:
    print(f"yaml: ERRO {e}")
EOF

DIST="$HOME/github/mercadolivre-mcp/dist/index.js"
[ -f "$DIST" ] || { echo "ERRO: build ausente ($DIST) — rode npm run build"; exit 1; }
echo "build: OK ($DIST)"

python3 - <<'EOF'
env = {}
for l in open("/home/hermes/.hermes/.env", encoding="utf-8"):
    l = l.strip()
    if l and not l.startswith("#") and "=" in l:
        k, v = l.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
missing = [k for k in ("ML_SITE_ID", "ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REFRESH_TOKEN") if not env.get(k)]
print("env: OK" if not missing else f"env: FALTANDO {missing}")
EOF

echo "Pronto. Reinicie o gateway POR FORA (ssh/shell externo) para valer."
