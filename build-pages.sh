#!/bin/sh
# index.html（claude.ai 用）から GitHub Pages 用の docs/index.html を作る
cd "$(dirname "$0")"
mkdir -p docs
{
  printf '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n'
  cat index.html
  printf '\n</body>\n</html>\n'
} > docs/index.html
touch docs/.nojekyll
