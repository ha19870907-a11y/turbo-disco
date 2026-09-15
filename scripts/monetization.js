'use strict';

// STEP3.5: 収益導線(アフィリエイト・自社サイト送客・有料コンテンツ・専門家送客など)の
// リンク管理とコンバージョン計測データの読み書きを行う共有モジュール。
//
// 【設計方針】
// - STEP1〜STEP3のファイル(thread-post-history.json / thread-templates.json /
//   weekly-schedule.json / thread-insights.json)は一切変更しない。
// - 投稿とリンクの紐付けは新規ファイル scripts/template-links.json
//   (テンプレートID→リンクID)で管理し、thread-templates.jsonには手を入れない。
// - Threads APIから取得できない指標(プロフィール訪問数など)は取得せず、
//   取得可能な指標(リンククリック数・コンバージョン数・売上)は外部の計測手段
//   (広告主・ASPの管理画面、Googleアナリティクス等)から人が入力する前提とする。
//   自動でクリック数等を推測・捏造することはしない。

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..');
const LINKS_FILE = path.join(__dirname, 'monetization-links.json');
const TEMPLATE_LINKS_FILE = path.join(__dirname, 'template-links.json');
const MONETIZATION_DATA_FILE = path.join(ROOT_DIR, 'monetization-data.json');

// Threads側で計測できる指標と、Threads APIでは取得できない指標を明示しておく。
// 取得不可な指標に架空の値を入れないためのガードとして参照する。
const AVAILABLE_METRICS = ['clicks', 'conversions', 'revenue'];
const UNAVAILABLE_METRICS = {
  profileVisits:
    'Threads APIに相当する指標が存在しないため取得不可。UTM等の外部計測でも、' +
    'Threadsのプロフィール画面上での訪問は計測対象外(外部サイトに来て初めて計測できるため)。',
};

// revenueTypeの想定値(自由記述も許容するが、代表的な分類の目安として列挙)。
const REVENUE_TYPES = [
  'affiliate', // アフィリエイト
  'own_site', // 自社サイトへの送客
  'paid_content', // 有料PDF/電子書籍/有料コンテンツ
  'professional_referral', // 税理士・社労士・行政書士等の専門家への送客
  'own_service', // 自社サービス
  'other', // その他
];

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readLinks() {
  return readJson(LINKS_FILE, []);
}

function writeLinks(links) {
  writeJson(LINKS_FILE, links);
}

function readTemplateLinks() {
  return readJson(TEMPLATE_LINKS_FILE, {});
}

function writeTemplateLinks(map) {
  writeJson(TEMPLATE_LINKS_FILE, map);
}

function readMonetizationData() {
  return readJson(MONETIZATION_DATA_FILE, []);
}

function writeMonetizationData(records) {
  writeJson(MONETIZATION_DATA_FILE, records);
}

function findLink(linkId) {
  return readLinks().find((link) => link.linkId === linkId) ?? null;
}

// UTM付きの計測用URLを生成する。linkのbaseUrlに、投稿を特定できるutm_contentを付与する。
// 実際に存在しない解析ツール・APIは前提にせず、URLの構築のみを行う
// (実際のクリック計測は遷移先のサイト側のアクセス解析で行う想定)。
function buildTrackingUrl(link, { postId } = {}) {
  if (!link || !link.baseUrl) {
    throw new Error('リンクにbaseUrlが設定されていません。');
  }
  const url = new URL(link.baseUrl);
  url.searchParams.set('utm_source', 'threads');
  url.searchParams.set('utm_medium', 'social');
  url.searchParams.set('utm_campaign', link.campaignId ?? link.linkId);
  if (postId) {
    url.searchParams.set('utm_content', postId);
  }
  return url.toString();
}

function monetizationRecordKey(postId, linkId) {
  return `${postId}::${linkId}`;
}

// 投稿にリンクが使われたことを記録する(投稿直後に呼ぶ想定)。
// クリック数・コンバージョン数・売上はまだ計測されていないため0で初期化し、
// 架空の実績値は入れない。
function registerPostLink({ postId, linkId, genre, category, angle, templateId }) {
  if (!postId || !linkId) {
    throw new Error('postIdとlinkIdは必須です。');
  }
  const link = findLink(linkId);
  if (!link) {
    throw new Error(`リンクID ${linkId} が monetization-links.json に見つかりません。`);
  }

  const records = readMonetizationData();
  const key = monetizationRecordKey(postId, linkId);
  const existing = records.find((r) => monetizationRecordKey(r.postId, r.linkId) === key);
  const now = new Date().toISOString();

  if (existing) {
    // 既に記録済み(再投稿・再実行等)なら実績値は保持し、紐付け情報だけ最新化する。
    existing.campaignId = link.campaignId ?? null;
    existing.source = 'threads';
    existing.medium = 'social';
    existing.campaign = link.campaignId ?? null;
    existing.content = postId;
    existing.templateId = templateId ?? existing.templateId ?? null;
    existing.genre = genre ?? existing.genre ?? null;
    existing.category = category ?? existing.category ?? null;
    existing.angle = angle ?? existing.angle ?? null;
    existing.trackingUrl = buildTrackingUrl(link, { postId });
    existing.updatedAt = now;
    writeMonetizationData(records);
    return existing;
  }

  const record = {
    postId,
    linkId,
    campaignId: link.campaignId ?? null,
    revenueType: link.revenueType ?? null,
    destination: link.destination ?? null,
    source: 'threads',
    medium: 'social',
    campaign: link.campaignId ?? null,
    content: postId,
    trackingUrl: buildTrackingUrl(link, { postId }),
    templateId: templateId ?? null,
    genre: genre ?? null,
    category: category ?? null,
    angle: angle ?? null,
    conversionType: null,
    clicks: 0,
    conversions: 0,
    revenue: 0,
    currency: 'JPY',
    createdAt: now,
    updatedAt: now,
  };
  records.push(record);
  writeMonetizationData(records);
  return record;
}

// 外部の計測手段(広告主・ASPの管理画面、Googleアナリティクス等)から得た実績値を
// 手動で反映するための更新関数。値は「その時点での累計」として上書きする
// (thread-insights.jsonのKPIと同じ「絶対値を都度上書き」方式に合わせている)。
function updateMonetizationRecord({ postId, linkId, clicks, conversions, revenue, conversionType }) {
  const records = readMonetizationData();
  const key = monetizationRecordKey(postId, linkId);
  const record = records.find((r) => monetizationRecordKey(r.postId, r.linkId) === key);
  if (!record) {
    throw new Error(
      `postId=${postId} / linkId=${linkId} の記録が見つかりません。先にregisterPostLinkで登録してください。`
    );
  }
  if (clicks != null) record.clicks = Number(clicks);
  if (conversions != null) record.conversions = Number(conversions);
  if (revenue != null) record.revenue = Number(revenue);
  if (conversionType != null) record.conversionType = conversionType;
  record.updatedAt = new Date().toISOString();
  writeMonetizationData(records);
  return record;
}

module.exports = {
  AVAILABLE_METRICS,
  UNAVAILABLE_METRICS,
  REVENUE_TYPES,
  readLinks,
  writeLinks,
  readTemplateLinks,
  writeTemplateLinks,
  readMonetizationData,
  writeMonetizationData,
  findLink,
  buildTrackingUrl,
  registerPostLink,
  updateMonetizationRecord,
};
