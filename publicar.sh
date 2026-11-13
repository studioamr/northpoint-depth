#!/bin/bash
# Publica NORTHPOINT DEPTH en northpointcapital.io/depth (repo del sitio) y deja el redirect en GitHub Pages.
set -e
cd "$(dirname "$0")"
DST=../northpoint-capital/depth
mkdir -p "$DST/js"
cp index.html app.html login.html marca.html "$DST/"
cp js/*.js "$DST/js/"
cd ../northpoint-capital && git pull -q --rebase && git add depth && (git diff --cached --quiet || git commit -q -m "NORTHPOINT DEPTH: actualizacion" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>") && git push -q
echo "Publicado en https://northpointcapital.io/depth/"
