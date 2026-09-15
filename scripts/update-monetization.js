#!/usr/bin/env node
'use strict';

// STEP3.5: リンククリック数・コンバージョン数・売上を手動で反映するCLI。
// Threads APIにはこれらの指標が存在しないため、遷移先サイトのアクセス解析や
// ASP(アフィリエイト管理画面)など、外部の計測手段で得た実績値を人が入力する。
// 自動で数値を推測・生成することはしない。
//
// 使い方:
//   node scripts/update-monetization.js --postId <投稿ID> --linkId <リンクID> \
//     [--clicks 12] [--conversions 2] [--revenue 6000] [--conversionType purchase]
//
// 値は「その時点までの累計」として上書きする(差分ではない)。

const { updateMonetizationRecord } = require('./monetization.js');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    args[key] = value;
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.postId || !args.linkId) {
    console.error(
      '使い方: node scripts/update-monetization.js --postId <投稿ID> --linkId <リンクID> ' +
        '[--clicks N] [--conversions N] [--revenue N] [--conversionType TYPE]'
    );
    process.exitCode = 1;
    return;
  }

  const record = updateMonetizationRecord({
    postId: args.postId,
    linkId: args.linkId,
    clicks: args.clicks,
    conversions: args.conversions,
    revenue: args.revenue,
    conversionType: args.conversionType,
  });

  console.log('更新しました:');
  console.log(JSON.stringify(record, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
