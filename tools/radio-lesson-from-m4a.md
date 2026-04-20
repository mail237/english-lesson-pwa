# ラジオ（m4a）から `english-lesson-pwa` 用の教材 JSON をつくる

## 著作権・利用について（必読）

- **原則**: 第三者（放送局・出版社など）が権利を持つ**台本・スクリプトの全文や長い抜粋**を、このリポジトリの JSON にそのまま貼らないでください。公式が許す範囲は**各自が利用規約で確認**します。
- **安全にやる方法**: 自分の**聞き取りメモ**だけを `dialogue` / `vocabulary` に書く。または、**自分で著作権がある**・**パブリックドメイン等で明示されている**テキストだけを使う。
- **音声ファイル（m4a）**: 私的な復習用に手元のフォルダへコピーする程度にとどめ、**公開配布や他人への再配布はしない**（リポジトリにコミットする場合も同様に注意）。詳しくはリポジトリ直下の `COPYRIGHT-NOTES.txt` を参照。

## できること / できないこと

- **できる**: 手元の `.m4a` をプロジェクトの `media/radio/` にコピーして保管する（**私的利用の範囲**で。配布しない）。
- **できる**: `data/lessons/heart-gokui-ep15-2026-04-17-stub.json` を編集し、**上記に沿ったテキストだけ**で `dialogue` / `vocabulary` / `keywords` を埋める。
- **このリポジトリの単語テスト PWA がやっていること**: ブラウザの読み上げ（`speechSynthesis`）で英語を聞かせる。**m4a をアプリ内で再生する UI はない**（追加開発が必要）。
- **避けること**: 放送の**公式台本の無断転載**を JSON にコミットすること。

## 手順（おすすめ）

1. **音声をコピー**（ファイル名を ASCII にそろえると安全）

   ```bash
   bash tools/podcast-m4a-to-lesson-dir.sh \
     "/Users/tomohiro/Music/Music/Media.localized/Music/ラジオ英会話ハートでつかめ！英語の極意/ラジオ英会話ハートでつかめ！英語の極意/01 第15回 (2026-04-17).m4a"
   ```

2. **テキスト化（任意）**  
   自分で聞き取るか、手元で Whisper などを動かして**あなたの下書き**を作る（誤認識の校正は必須）。機械出力をそのまま「公式台本」とみなして公開しないこと。

   ```bash
   # 例（別途: pip install openai-whisper / ffmpeg 必須）
   whisper media/radio/heart-gokui-2026-04-17-ep15.m4a --language English --model small
   ```

3. **`data/lessons/heart-gokui-ep15-2026-04-17-stub.json` を編集**  
   - `dialogue`: `{ "speaker": "...", "text": "..." }` の配列  
   - `vocabulary` / `keywords`: 出題したい語・フレーズと `hintJa`  
   - 余計なプレースホルダ語は削除  

4. **学年一覧に載っているか確認**  
   `data/lessons/index.json` にエントリ済み（「ラジオ（ひな形）」）。

5. **LAN で開く**  
   いつもどおり `python3 serve_lan.py` → iPad から `http://（MacのIP）:8765/`。

## 公式の聞き逃し

番組ページ（NHK）の聞き逃しとあわせて使うと、音声と教材の対応が取りやすいです:  
[ラジオ英会話 — ハートでつかめ!英語の極意（番組一覧）](https://www.nhk.jp/p/rs/PMMJ59J6N2/list/)
