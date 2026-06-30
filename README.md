# SNSトレンドバズフィード

SharePoint社内広報ポータルへ iframe 埋め込みするための GitHub Pages 向け静的アプリです。

## ページ

- `compact/`: SharePointトップページ用の小型表示
- `list/`: SharePoint別ページ用の観測ダッシュボード

## データ取得

`scripts/fetch-trends.mjs` は Google Trends JP の公開RSSと Google News RSS検索を使います。

Google Trends JP の上位RSSだけではウォッチリスト語に一致せず0件になることがあるため、ウォッチリスト語と発見用クエリを公開RSSで観測します。さらにRSS見出しから `〇〇構文`、`〇〇界隈`、`〇〇チャレンジ`、`〇〇音源`、引用符内のミーム名、ハッシュタグなどを抽出します。

ただし、抽出しただけの語は「急上昇」扱いしません。`evidenceCount` を履歴に残し、次回取得時に `evidenceChange` を比較します。前回より反応が見える語は「話題」として扱い、初回または比較不能な語は「観測候補」に分けます。記事本文やニュース一覧は表示しません。

画面では、Google Trends RSSに載った公開トレンドを「いま話題の実トレンド」、前回より反応が見える独自観測語を「話題」、横ばいでも継続して出ている構文・あるある・企画型を「よく使われる投稿ネタ」として分けて表示します。

Google Trends RSS上位だけでは拾いにくいワールドカップなどの大型イベントは、`config/major-topics.json` で別枠観測し、「大型トピック・開催中イベント」に表示します。

有料API、契約API、非公開API、画面スクレイピング、AI推定、正確な投稿数表示は使っていません。

## GitHub Pages公開手順

1. このフォルダの中身を GitHub リポジトリの `main` ブランチへアップロードします。
2. GitHub の `Settings > Pages` で `Source` を `GitHub Actions` にします。
3. `Actions` タブで `Update data and deploy Pages` を手動実行します。
4. 初回実行後、GitHub Pages のURLが発行されます。
5. `config/site.json` の `sharePointListUrl` を実際のSharePoint一覧ページURL、または発行された `list/` URL に変更します。

`.github/workflows/fetch-trends.yml` は、以下をまとめて実行します。

- 公開RSSからトレンドデータを取得
- `data/` 配下のJSONを更新してコミット
- GitHub Pagesへ静的サイトをデプロイ

定期実行は日本時間の 9:00 / 12:00 / 15:00 / 18:00 相当です。

## 調整ポイント

- 地域・業種ワード: `config/watchlists.json`
- 投稿ネタ化しやすい複合テーマ: `config/observe-queries.json`
- ミーム・構文・動画フォーマット発見用クエリ: `config/discovery-queries.json`
- 大型イベント・継続観測トピック: `config/major-topics.json`
- ローカルSNS観測棚: `config/local-observation.json`

## 手動取得

```bash
node scripts/fetch-trends.mjs
```

## SharePoint iframe

compact版:

```html
<iframe src="https://YOUR_ORG.github.io/YOUR_REPO/compact/" width="100%" height="360"></iframe>
```

list版:

```html
<iframe src="https://YOUR_ORG.github.io/YOUR_REPO/list/" width="100%" height="1200"></iframe>
```
