// 日別レースデータ(1日分, 数MB)をIndexedDBに永続キャッシュする。
// 過去の確定済みの日のデータは内容が変わらないため、一度取得したら期限なしで使い回してよい。
const DB_NAME = "kyotei-day-cache-v1";
const STORE = "days";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedDay(date) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(date);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null; // プライベートブラウジング等でIndexedDBが使えない場合はキャッシュ無しで継続
  }
}

export async function putCachedDay(date, data) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, date);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 保存に失敗しても致命的ではないため無視する
  }
}
