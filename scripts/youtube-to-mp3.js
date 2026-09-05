#!/usr/bin/env node
"use strict";

// YouTube動画の音声をmp3に変換して保存する、個人利用専用のCLIツールです。
// 著作権のある動画のダウンロードはYouTubeの利用規約に抵触する可能性があるため、
// 自分がアップロードした動画や、私的利用が認められる範囲でのみ使用してください。

const fs = require("fs");
const path = require("path");
const ytdl = require("@distube/ytdl-core");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

const DEFAULT_OUTPUT_DIR = path.join(__dirname, "..", "downloads");

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

async function convertToMp3(url, outputDir) {
  if (!ytdl.validateURL(url)) {
    throw new Error(`不正なYouTube URLです: ${url}`);
  }

  const info = await ytdl.getInfo(url);
  const title = sanitizeFileName(info.videoDetails.title) || info.videoDetails.videoId;

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${title}.mp3`);

  const audioStream = ytdl.downloadFromInfo(info, { quality: "highestaudio" });

  await new Promise((resolve, reject) => {
    ffmpeg(audioStream)
      .audioBitrate(192)
      .format("mp3")
      .on("error", reject)
      .on("end", resolve)
      .save(outputPath);
  });

  return outputPath;
}

async function main() {
  const [, , url, outputDirArg] = process.argv;

  if (!url) {
    console.error("使い方: npm run convert:mp3 -- <YouTubeのURL> [出力先ディレクトリ]");
    process.exit(1);
    return;
  }

  const outputDir = outputDirArg || DEFAULT_OUTPUT_DIR;

  try {
    console.log("動画情報を取得中...");
    const outputPath = await convertToMp3(url, outputDir);
    console.log(`変換完了: ${outputPath}`);
  } catch (err) {
    console.error(`エラー: ${err.message}`);
    process.exit(1);
  }
}

main();
