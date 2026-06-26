// ============================================================
// Firebase 設定ファイル
// ============================================================
// Firebase Console (https://console.firebase.google.com/) で
// プロジェクトを作成してから、下の値を書き換えてください。
//
// 手順:
// 1. Firebase Console でプロジェクトを作成
// 2. 「ウェブアプリを追加」してSDK設定をコピー
// 3. Authentication → ログイン方法 → Google を有効化
// 4. Firestore Database → 作成（本番モード）
// 5. 下のオブジェクトを実際の値で書き換える
// ============================================================

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";

export const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Firebase が設定済みかどうか
export const FB_READY = FIREBASE_CONFIG.projectId !== "YOUR_PROJECT_ID";

let _auth = null;
let _db = null;

if (FB_READY) {
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    _auth = getAuth(app);
    _db = getFirestore(app);
    // オフラインキャッシュを有効化
    enableIndexedDbPersistence(_db).catch(() => {});
  } catch (e) {
    console.warn("Firebase init failed:", e);
  }
}

export const fbAuth = _auth;
export const fbDb = _db;
