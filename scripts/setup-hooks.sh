#!/usr/bin/env bash
# Instala o hook pre-push: build + vitest. Vermelho bloqueia o push.
set -eu
HOOK="$(git rev-parse --git-dir)/hooks/pre-push"
cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
set -e
npm run build >/dev/null
npx vitest run
EOF
chmod +x "$HOOK"
echo "pre-push instalado em $HOOK"
