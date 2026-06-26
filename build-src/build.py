#!/usr/bin/env python3
"""Inject the esbuild bundle into index.html as a single inline <script>.

Robust against the bundle containing literal "<script>" substrings (esbuild
escapes the closing tag as "<\\/script>" but leaves "<script>" unescaped inside
string literals). We anchor on the <div id="root"></div> marker instead of
searching for <script> tags, so re-running never duplicates the bundle.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, "index.html")
BUNDLE = os.path.join(ROOT, "build-src", "app.bundle.js")
MARKER = '<div id="root"></div>'

with open(BUNDLE, encoding="utf-8") as f:
    bundle = f.read()
with open(HTML, encoding="utf-8") as f:
    html = f.read()

idx = html.index(MARKER)
head = html[:idx]  # head + styles (CSS lives here, preserved across builds)
new_html = head + MARKER + "\n<script>" + bundle + "\n</script>\n</body>\n</html>\n"

with open(HTML, "w", encoding="utf-8") as f:
    f.write(new_html)

print(f"index.html rebuilt: 1 bundle ({len(bundle)} bytes)")
