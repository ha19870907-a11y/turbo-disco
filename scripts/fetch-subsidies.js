#!/usr/bin/env node
"use strict";

// jGrants(https://www.jgrants-portal.go.jp/)の公開APIから補助金データを取得し、
// docs/subsidy/data/subsidies.json にスナップショットとして書き出すスクリプト。
//
// docs/subsidy/ のページはブラウザから直接jGrants APIを呼び出すとCORSでブロックされるため、
// このスクリプトをGitHub Actions(.github/workflows/refresh-subsidies.yml)から定期実行し、
// サーバー側(CI環境)で取得したデータを静的JSONとしてリポジトリにコミットしている。
//
// APIの keyword パラメータは必須(2文字以上)のため、幅広い語で複数回検索してマージすることで
// なるべく多くの制度を集めている。全自治体・全キーワードを網羅するものではない。

const fs = require("node:fs");
const path = require("node:path");
const { PURPOSE_TAGS, DECLINE_KEYWORDS } = require("../docs/subsidy/data.js");

const API_BASE = "https://api.jgrants-portal.go.jp/exp/v1/public/subsidies";
const OUTPUT_PATH = path.join(__dirname, "..", "docs", "subsidy", "data", "subsidies.json");
const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 15000;

const SEARCH_TERMS = Array.from(
  new Set([
    "補助金", "助成金", "中小企業", "小規模事業者", "個人事業主",
    ...PURPOSE_TAGS,
    ...DECLINE_KEYWORDS,
  ])
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchByKeyword(keyword) {
  const params = new URLSearchParams({
    keyword,
    sort: "acceptance_end_datetime",
    order: "ASC",
    acceptance: "1",
  });
  const data = await fetchJson(`${API_BASE}?${params.toString()}`);
  return (data && data.result) || [];
}

async function fetchDetail(id) {
  const data = await fetchJson(`${API_BASE}/id/${encodeURIComponent(id)}`);
  return (data && data.result && data.result[0]) || null;
}

function toItem(listEntry, detail) {
  const src = detail || listEntry;
  return {
    id: listEntry.id,
    title: src.title || listEntry.title || src.name || listEntry.name || "",
    institutionName: src.institution_name || null,
    subsidyMaxLimit: src.subsidy_max_limit ?? listEntry.subsidy_max_limit ?? null,
    subsidyRate: src.subsidy_rate || null,
    targetAreaSearch: src.target_area_search || listEntry.target_area_search || "",
    targetNumberOfEmployees: src.target_number_of_employees || listEntry.target_number_of_employees || "",
    acceptanceStartDatetime: src.acceptance_start_datetime || listEntry.acceptance_start_datetime || null,
    acceptanceEndDatetime: src.acceptance_end_datetime || listEntry.acceptance_end_datetime || null,
  };
}

async function main() {
  const byId = new Map();

  for (const term of SEARCH_TERMS) {
    try {
      const results = await searchByKeyword(term);
      for (const entry of results) {
        if (entry && entry.id && !byId.has(entry.id)) {
          byId.set(entry.id, entry);
        }
      }
      console.log(`"${term}": ${results.length}件 (累計 ${byId.size}件)`);
    } catch (err) {
      console.warn(`検索語 "${term}" の取得に失敗しました: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  if (byId.size === 0) {
    throw new Error("jGrants APIから1件もデータを取得できませんでした。API側の仕様変更やネットワーク障害の可能性があります。");
  }

  const items = [];
  for (const [id, listEntry] of byId) {
    let detail = null;
    try {
      detail = await fetchDetail(id);
    } catch (err) {
      console.warn(`詳細取得に失敗しました(id=${id}): ${err.message}`);
    }
    items.push(toItem(listEntry, detail));
    await sleep(REQUEST_DELAY_MS);
  }

  items.sort((a, b) => (a.acceptanceEndDatetime || "").localeCompare(b.acceptanceEndDatetime || ""));

  const output = {
    fetchedAt: new Date().toISOString(),
    source: "jGrants (https://www.jgrants-portal.go.jp/)",
    note: "複数の検索語でjGrants公開APIを検索し、重複を除いてまとめたスナップショットです。全制度を網羅するものではありません。",
    count: items.length,
    items,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`書き出し完了: ${items.length}件 → ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
