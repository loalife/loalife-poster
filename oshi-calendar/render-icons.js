// icon.svg から PNG アイコンを書き出す（開発用: NODE_PATH に playwright が必要）
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, "icon.svg"), "utf8");
  const browser = await chromium.launch();
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: path.join(__dirname, `icon-${size}.png`) });
    await page.close();
  }
  await browser.close();
})();
