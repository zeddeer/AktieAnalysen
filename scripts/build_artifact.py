#!/usr/bin/env python3
"""Build dist/artifact.html: the app as one page for a claude.ai Artifact.

The Artifact wraps the page in its own <html>/<head>/<body>, so this writes
only <title>, inline <style>, the body markup and inline <script>.
Data files (data/stocks.json, data/prices.json) are published next to it.
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
css = open(os.path.join(ROOT, "style.css"), encoding="utf-8").read()
js = open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()

body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = re.sub(r'\s*<script src="app.js"></script>', "", body)

out = f"""<title>AktieAnalysen</title>
<style>
{css}
</style>
{body.strip()}
<script>
{js}
</script>
"""
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
with open(os.path.join(ROOT, "dist", "artifact.html"), "w", encoding="utf-8") as f:
    f.write(out)
print("dist/artifact.html", len(out), "bytes")
