#!/usr/bin/env node
/**
 * assemble-www.js
 * -----------------------------------------------------------------------------
 * Capacitor の webDir（"www"）を、リポジトリにある本番の Web 資産から組み立てる。
 * index.html はビルド済み（build-src → build.py で bundle をインライン注入したもの）を
 * そのままコピーするだけ。ネイティブアプリはこの www/ をアプリ本体に同梱する（オフライン動作）。
 *
 * 使い方: node scripts/assemble-www.js  （npm run assemble / cap:sync から呼ばれる）
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WWW = path.join(ROOT, "www");

// www/ をクリーンに作り直す（古い資産の残留を防ぐ）
fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

// アプリ本体に同梱する資産（api/ は Vercel 専用のため含めない）
const FILES = [
  "index.html",
  "manifest.json",
  "sw.js",
  "icon-any-192.png",
  "icon-any-512.png",
  "icon-maskable-192.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
  "favicon.ico",
  "favicon-16.png",
  "favicon-32.png",
];

let copied = 0;
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) {
    console.warn(`  skip (not found): ${f}`);
    continue;
  }
  fs.copyFileSync(src, path.join(WWW, f));
  copied++;
}

// Capacitor はエントリに index.html を要求する
if (!fs.existsSync(path.join(WWW, "index.html"))) {
  console.error("ERROR: www/index.html が作成できませんでした。リポジトリ直下の index.html を確認してください。");
  process.exit(1);
}

const bytes = fs.statSync(path.join(WWW, "index.html")).size;
console.log(`www/ を組み立てました: ${copied} ファイル（index.html ${(bytes / 1024 / 1024).toFixed(2)} MB）`);
