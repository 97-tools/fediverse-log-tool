# Fediverseログ整形ツール

Mastodon系の `outbox.json` と、Misskey系のノートJSONを読み込み、HTML配布用・ふせったー貼り付け用テキストに整形する静的ツールです。

## 対応形式

- Mastodon系 / Fedibird系 ActivityPub outbox
  - `orderedItems` / `items`
  - 本文: `object.content`
  - CW: `object.summary`
  - 日付: `object.published`
  - 画像: `object.attachment`
- Misskey系 / 卓すきー系 notes JSON
  - 配列形式
  - 本文: `text`
  - CW: `cw`
  - 日付: `createdAt`
  - 画像: `files`

## 使い方

1. `index.html` をブラウザで開きます。
2. JSONファイルを選択、またはJSON本文を貼り付けます。
3. 含める語句・除外する語句・CWの出し方などを選びます。
4. 「整形する」を押します。
5. HTML保存、HTMLコピー、ふせったー用テキストコピー、TXT保存ができます。

## GitHub Pagesで公開する場合

このフォルダ内の `index.html` / `app.js` / `style.css` / `README.md` をリポジトリ直下に置き、Settings → Pages から `main` / `/root` を公開してください。

## 注意

処理はブラウザ内だけで行われます。読み込んだJSONを外部サーバーへ送信しません。
