# Vercel で公開する

このフォルダは **ビルド不要の静的サイト**（HTML / CSS / JS / JSON）です。Vercel にそのまま載せられます。

## 手順（CLI）

1. [Vercel](https://vercel.com) にサインアップし、GitHub と連携（任意）する。
2. ターミナルでこのディレクトリに移動する。

   ```bash
   cd english-lesson-pwa
   ```

3. Vercel CLI を入れる（未インストールの場合）。

   ```bash
   npm i -g vercel
   ```

4. 初回デプロイ。

   ```bash
   vercel
   ```

   対話に従う（プロジェクト名・ディレクトリはこのフォルダのまま）。  
   **Build Command / Output Directory は空のまま**（フレームワーク検出に任せるか、「Other」で静的のみ）。

5. 本番 URL に固定する場合。

   ```bash
   vercel --prod
   ```

## 手順（GitHub から）

1. この `english-lesson-pwa` をリポジトリのルートとして push する（またはモノレポなら **Root Directory** を `english-lesson-pwa` に設定）。
2. Vercel の **New Project** → リポジトリを選ぶ。
3. **Framework Preset**: Other または Vite など検出されても **Override** でビルドなしにできるが、通常は **静的ファイルのみ** なら **Build Command 空**、**Output Directory 空** または **`.`** でよい。
4. Deploy。

モノレポの例: リポジトリが `/Users/tomohiro` 全体で、`english-lesson-pwa` だけをデプロイするときは **Root Directory** に `english-lesson-pwa` を指定する。

## 注意

- 公開 URL は **HTTPS** のため、`file://` 制限は出ません。PWA の Service Worker も動きます。
- 教材 JSON を更新したあと、ブラウザが古いキャッシュを掴むことがある場合は **スーパーリロード** か **`index.html?nosw=1`** で確認（開発時）。
- `vercel.json` の `/sw.js` 用 `Cache-Control` で、SW の更新が取りこぼされにくくしています。
