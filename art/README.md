# 元画像の置き方

Midjourneyで作った元の画像は、PNGのまま保管します。加工済み画像は `assets/` に置きます。ゲームは `art/` を読みません。

|種類|置き場所|ファイル名|
|---|---|---|
|仲間|`art/chars/`|`akane.png`, `mizuha.png`, `yomogi.png`, `ruka.png`, `nocto.png`, `kagura.png`, `shizuku.png`, `tsubaki.png`, `hikari.png`, `crow.png`|
|雑魚|`art/mobs/`|`sentinel.png`, `wisp.png`, `golem.png`|
|ボス|`art/bosses/`|`d1.png`〜`d8.png`|

名前はゲーム内のIDにそろえます。候補が複数あるときは、使うものを上の名前にし、ほかは `mizuha_2.png`、`mizuha_3.png` のように番号を付けます。`.gitkeep` は画像がないときも置き場所をGitに残すためのファイルです。

ゲーム用に加工した画像は `assets/` に置き、`assets/manifest.json` に登録します。一覧を更新したら、ダブルクリックで開く場合のために `index.html` の `ASSET_MANIFEST_FALLBACK` も同じ内容に更新してください。
