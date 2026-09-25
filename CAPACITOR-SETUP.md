# LOALIFE をネイティブアプリにする（iOS / Android）— セットアップ手順

このリポジトリには **Capacitor** が導入済みです。Capacitor は、いまの Web アプリ
（`index.html` にバンドル済み）を **そのままネイティブアプリの中に同梱** して、
App Store / Google Play に出せる形にするツールです。アプリのコードを書き直す必要はありません。

- **アプリ本体**は `www/` に組み立てた Web 資産（オフラインでも動く）
- **appId**: `com.loalife.app` ／ **アプリ名**: `LOALIFE`
- 天気（Open‑Meteo / 気象庁）と Firebase は端末から直接通信するので、ネイティブでもそのまま動きます

> リポジトリ側の準備（Capacitor 導入・設定ファイル・www 組み立て・手順書）は完了しています。
> ここから先の **開発者アカウント登録・署名・ストア審査提出** は、あなたのマシン（Mac 等）で行います。

---

## 0. 必要なもの（事前準備）

| 対象 | 必要なもの | 費用 |
|------|-----------|------|
| 共通 | Node.js 18+（推奨 20/22）、このリポジトリ | 無料 |
| **iOS** | **Mac** + **Xcode**（App Store から無料）＋ **Apple Developer Program** | **$99 / 年** |
| **Android** | **Android Studio**（無料、Win/Mac/Linux 可）＋ JDK 17 ＋ **Google Play Console** | **$25（初回のみ）** |

> iOS のビルド・提出には **Mac が必須**です（Apple の制約）。Android は Windows / Mac / Linux どれでも可。

---

## 1. 依存パッケージのインストール（初回だけ）

リポジトリ直下で：

```bash
npm install
```

`@capacitor/core` `@capacitor/cli` `@capacitor/ios` `@capacitor/android` などが入ります。

---

## 2. Web 資産を組み立てる → ネイティブプロジェクトを作成

```bash
# index.html などを www/ にコピー
npm run assemble

# iOS プロジェクトを追加（Mac のみ）
npx cap add ios

# Android プロジェクトを追加
npx cap add android
```

これで `ios/` と `android/` の**ネイティブプロジェクトが生成**されます。
（これらは `.gitignore` 済み。各自のマシンで生成し、必要なら別途コミットしてください。）

以降、**Web を更新したとき**は必ず同期します：

```bash
npm run cap:sync    # = assemble + cap sync（www を作り直してネイティブへ反映）
```

---

## 3. アイコン & スプラッシュ画面の生成

`@capacitor/assets` で全サイズを自動生成できます。**1024×1024 の元画像**を用意するのが理想です。

1. `assets/` フォルダを作り、以下を置く（無ければ既存の `icon-any-512.png` からでも可、ただし 1024 推奨）
   - `assets/icon.png`（1024×1024、正方形・余白なし）
   - `assets/icon-foreground.png` / `assets/icon-background.png`（Android アダプティブ用、任意）
   - `assets/splash.png`（2732×2732 推奨、中央にロゴ）
2. 生成：

```bash
npm run assets
```

> 背景色はブランドカラー（ライト `#F0EBDF` / ダーク `#1B1712`）に設定済みです（`package.json` の `assets` スクリプト）。

---

## 4. 実機・シミュレータで動作確認

```bash
# iOS（Xcode が開く → 実機/シミュレータで実行）
npm run cap:open:ios
# または: npx cap run ios

# Android（Android Studio が開く）
npm run cap:open:android
# または: npx cap run android
```

チェックポイント：起動して白画面にならないか／記録・写真・天気・家族共有（Firebase）が動くか。

---

## 5. 権限の宣言（審査で必須）

このアプリは **写真・カメラ・位置情報・通知** を使います。ネイティブでは OS に権限説明が必要です。

### iOS — `ios/App/App/Info.plist` に追記

```xml
<key>NSCameraUsageDescription</key>
<string>ペットや家族の写真を記録に追加するためにカメラを使用します。</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>アルバムの写真を記録に追加するために使用します。</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>作成した画像をアルバムに保存するために使用します。</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>現在地の天気・お散歩判定のために位置情報を使用します。</string>
```

### Android — `android/app/src/main/AndroidManifest.xml`

必要に応じて（写真ピッカー / 位置情報 / 通知）：

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
```

> いまの Web アプリはブラウザ API（`getUserMedia` / `geolocation` / `<input type=file>`）を使うため、
> Capacitor の WebView がこれらを OS 権限に橋渡しします。追加のネイティブプラグインは基本不要です。

---

## 6. iOS：App Store へ提出

1. `npm run cap:sync && npx cap open ios` で Xcode を開く
2. **Signing & Capabilities** で自分の **Team**（Apple Developer アカウント）を選択、
   Bundle Identifier が `com.loalife.app` になっているか確認
3. デバイスを **Any iOS Device (arm64)** にして **Product ▸ Archive**
4. **Organizer** から **Distribute App ▸ App Store Connect** でアップロード
5. [App Store Connect](https://appstoreconnect.apple.com) で新規アプリを作成し、
   スクショ・説明文・**プライバシー（データ収集の申告）**・年齢区分を入力して審査提出

> **審査のコツ（重要）**: 単なる「Web サイトの表示」だと Guideline 4.2 で弾かれます。
> 本アプリはオフラインで動くローカル記録・写真保存・天気連携など**独立した機能**があるので、
> 審査ノートに「端末内で完結する家族/ペット/育児/介護の記録アプリ」であることを明記してください。

---

## 7. Android：Google Play へ提出

1. **署名鍵（keystore）を作成**（初回だけ・大切に保管）：

```bash
keytool -genkey -v -keystore loalife-release.keystore \
  -alias loalife -keyalg RSA -keysize 2048 -validity 10000
```

2. `android/keystore.properties` を作成（Git に入れない）：

```properties
storeFile=/絶対パス/loalife-release.keystore
storePassword=****
keyAlias=loalife
keyPassword=****
```

（`android/app/build.gradle` の `signingConfigs` から読み込むよう設定します。手順は
Capacitor 公式「Signing your app」を参照。）

3. **AAB をビルド**：

```bash
npm run cap:sync
npx cap open android    # Android Studio: Build ▸ Generate Signed Bundle/APK ▸ Android App Bundle
# または CLI:
cd android && ./gradlew bundleRelease   # 出力: android/app/build/outputs/bundle/release/app-release.aab
```

4. [Google Play Console](https://play.google.com/console) でアプリを作成し、
   `.aab` をアップロード → ストア掲載情報・**データセーフティ**・コンテンツレーティングを入力して審査提出

---

## 8. アプリを更新するとき（毎回のフロー）

1. Web 側を編集 → **バンドルを再ビルド**（このリポジトリの流儀）：
   ```bash
   cd build-src && node_modules/.bin/esbuild app.jsx --bundle --format=iife --minify --jsx=automatic --outfile=app.bundle.js
   cd .. && python3 build-src/build.py
   ```
2. ネイティブへ反映：
   ```bash
   npm run cap:sync
   ```
3. `package.json`（`version`）と、iOS の build 番号 / Android の `versionCode` を上げる
4. 6・7 の手順で再アーカイブ → ストアに新バージョンを提出

> Web の内容はアプリに**同梱**されているため、内容を変えたら**ストアの再提出が必要**です
> （＝オフラインでも最新が動く、という設計上のトレードオフ）。

---

## よくある質問

- **Q. Web（Vercel）版はどうなる？** → そのまま維持されます。ネイティブは同じ `index.html` を同梱するだけ。
- **Q. Service Worker は？** → ネイティブでは自動で無効化しています（`index.html` で `!window.Capacitor` ガード）。同梱資産と競合しないためです。
- **Q. ブランド表記（ポスター等の `· loalife-poster.vercel.app`）は？** → ネイティブでは `location.host` が `localhost` になるため、自動で正規ドメイン表示に固定しています。
- **Q. `loalife-app/`（Expo の雛形）は使う？** → 使いません。Capacitor 方式に統一しました（このフォルダは削除して構いません）。

---

参考: [Capacitor 公式ドキュメント](https://capacitorjs.com/docs) ／
[iOS 配布](https://capacitorjs.com/docs/ios/deploying-to-app-store) ／
[Android 署名・配布](https://capacitorjs.com/docs/android/deploying-to-google-play)
