# Claude からの更新（2026-10-09）

この zip の index.html は、Claude の作業用コピー（10/7 に受け取った index.html ＋ Claude の変更）。
Codex のコミット 17aa963・3c00ed1 の index.html の変更は入っていない。

## 入っている変更
1. ボスの絵（d2〜d8）：assets/boss_d2.webp 〜 boss_d7.webp、boss_d8_f1〜f3.webp
   - manifest の bosses に追加。形態が変わるボスは「id_f形態番号」（d8_f2, d8_f3）の絵に切り替わる（enemyAsset、v.form、fxEnemySkill）
   - 顔のある絵は glow:false（目の光を出さない）
   - d7 のボスを紅属性・仮の名前「緋翼の剣鬼ヴァーミリオン」、大技「緋閃・断界」に変更（仕掛けはそのまま）
   - d8：第2形態の属性を冥に、名前「オブシディアン・深淵」。第3形態は「終焉神オブシディアン」、2ターンごとに属性が変わる（attrChange every:2 phase:3）
2. 仲間9人の絵：assets/<id>_full.webp、<id>_face.webp、manifest の chars に cutin
3. 結果画面：レベルが上がっている仲間の顔〜胸を大きく出す帯（makeRewardHero）、行のアイコンを顔の紋章に
4. ミュート：settings.mute（セーブに保存、初期 false）、戦闘中のボタン #muteBtn、設定画面の項目、キーボードの M、知らせ #toast
5. レベルで覚える連鎖技と能力アップ：docs/design-growth.md
   - growCharacter の攻撃・スキルの溜めが Lv10 以上で変わる（levelPerks）
   - resolveTurn に連鎖数（chains）と art イベント。LOGIC に pickArt・levelPerks を追加
6. デバッグ：演出見本に「ボスの絵を切替」「強攻撃〜奥義」、RUNE_DEBUG.startBoss(i)

## テストへの影響（直す必要があるかもしれないもの）
- growCharacter の能力値を Lv10 以上で確かめているテスト（能力アップで攻撃が上がる）
- saveSettings の項目を数えているテスト（mute が増えた）
- resolveTurn のイベントの並びを固定で確かめているテスト（連鎖技は通常の攻撃の前に art が入る。パーティの Lv が 5 未満なら出ない）
- 追加するテストは docs/design-growth.md の最後

## まだやっていないこと
- 難易度の調整（3c00ed1 の取り消しのあと、Claude がシミュレーターで数値を決める）。連鎖技・能力アップの数値も仮
