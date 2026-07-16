<p align="center">
  <img src="harness_banner.png" alt="myharness バナー" width="600">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.6.3-brightgreen.svg" alt="Version">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Claude_Code-Plugin-purple.svg" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/Runtime-Claude_Code_+_Codex-blueviolet.svg" alt="Dual Runtime">
  <img src="https://img.shields.io/badge/Patterns-6_Architectures-orange.svg" alt="6 Architecture Patterns">
  <img src="https://img.shields.io/badge/Quality_Gate-2--Layer-green.svg" alt="Two-Layer Quality Gate">
  <a href="https://github.com/cookyman74/my_harness/stargazers"><img src="https://img.shields.io/github/stars/cookyman74/my_harness?style=social" alt="GitHub Stars"></a>
</p>

# myharness — エージェントチーム・アーキテクチャ・ファクトリー

[English](README.md) | [한국어](README_KO.md) | **日本語**

> **myharness は、ドメインを一文で表すだけでエージェントチームとスキルに変換する Claude Code・Codex デュアルランタイムのファクトリーです。**
> `「このプロジェクト用のハーネスを構成して」` の一言で — ドメインを分析し、専門エージェント定義（`.claude/agents/`）とスキル（`.claude/skills/`）を、6 つのチームアーキテクチャパターンの中から最適なもので生成します。

---

## myharness とは？

複雑なタスクを 1 つの巨大なプロンプトで処理すると、コンテキストが汚染され、同じ盲点を繰り返し、再利用もできません。myharness はそのタスクを **役割が分離された専門エージェントチーム + 手順を収めたスキル + これらを束ねるオーケストレーター** へと分解して生成します。

- **入力：** ドメインを表す一文（例：「ディープリサーチ」「フルスタック Web 開発」「コードレビュー」）
- **出力：** エージェント定義 + スキル + オーケストレータースキル + エントリポインタ（`CLAUDE.md`／`AGENTS.md`）
- **特徴：** 韓国語優先 · スリム基本（リスクが上がったときだけゲートを強化） · Claude Code／Codex 両方への出力

myharness 自体も 1 つのメタスキル（プラグイン）であり、**自身を進化させるシステム** として扱います — 実行フィードバックを該当レイヤー（スキル／エージェント／オーケストレーター）へ反映し、変更履歴を残します。

## クイックスタート

### 1. インストール（いずれか 1 つ）

**マーケットプレイス（推奨）**
```shell
/plugin marketplace add cookyman74/my_harness
/plugin install myharness@myharness-marketplace
```

**グローバルスキルとして直接コピー**
```shell
cp -r skills/myharness ~/.claude/skills/myharness
```

**Codex CLI（デュアルランタイム）** — リポジトリのルートで：
```shell
bash install.sh
# → ~/.codex/skills/myharness  (正本シンボリックリンク、常に最新)
# → .agents/skills/myharness   (trusted プロジェクト用)
# → AGENTS.md                  (Codex 自動ロード)
```

### 2. エージェントチーム有効化 + CLI 起動 (Claude Code)
```shell
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude   # Claude Code CLI 起動 (Codex は codex コマンド)
```

### 3. トリガー
- **Claude Code：** `このプロジェクト用のハーネスを構成して` · `/myharness` · `このドメイン用のエージェントチームを設計して`
- **Codex：** `$myharness` · `/skills` メニュー · `ハーネスを構成して`（説明マッチング）。インストール後はセッション再起動を推奨。（Codex はカスタムスラッシュコマンド非対応 — `/myharness` は不可）

> コピペ可能なドメイン別の例 → [使用例のプロンプト](#使用例のプロンプト)

## 主な機能

| 機能 | 内容 |
|------|------|
| **6 つのチームアーキテクチャ** | パイプライン · ファンアウト／ファンイン · エキスパートプール · 生成-検証 · スーパーバイザー · 階層的委譲。ドメインに合ったパターンを選択 |
| **エージェントチーム基本** | チームメンバーを `Agent` ツールで spawn、`SendMessage` で直接通信、共有タスクリスト（`TaskCreate`）で自己調整。発見の共有・対立の議論で品質↑ |
| **スキル自動生成** | Progressive Disclosure（メタデータ→本文→references の段階ロード）でコンテキスト効率化。トリガーの description は積極的に記述 |
| **2 層品質ゲート** | 内部の生成-検証 QA **＋** 外部の独立レビューループ。詳細は下記 |
| **教義の注入** | コード／修正エージェントの作業原則に TDD（`tdd-doctrine.md`）・開発ルール（`dev-rules.md`）を **実パス** で注入。**テスト＝第一級レビュー成果物**（RED を GREEN 前に検証、契約・スキーマ・セキュリティのテストのみ外部クロスレビュー）・**安全なロールバック規律**（破壊的 `git reset --hard` を廃止）を含む。リスク等級（軽量／標準／重大）でゲート強度を調整 |
| **ドキュメント体系** | 中核成果物（設計書・作業計画書・結果書）は `docs/{project}/`（永続・コミットされる監査台帳）、一時物は `_workspace/`（揮発）に2層分離 — 結果書の揮発を防止（RAG 知識循環）。ドキュメントティア（基本は軽量）・git-staging promote・fail-fast。外部レビューツールに非依存（無ければ内部 QA） |
| **デュアルランタイム** | 単一の正本（`skills/myharness/`）+ ランタイム別の薄いアダプター。`CLAUDE.md`／`AGENTS.md` の両方を出力し、オーケストレーションを分岐（Claude は `Agent` チームメンバー spawn ↔ Codex はネイティブ subagents／`codex exec`）。Phase 7 の同期で drift を防止 |
| **ビルド済みハーネスの更新** | `/myharness update`（Codex は `$myharness update`） — ファクトリーの正本を既にビルドされたハーネスへ再伝播しつつ **ローカル修正を保護**。`.harness-manifest.json` のハッシュ分類（SAME／自動／USER-MODIFIED 保留／NEW）、`*.local.*` で更新を安全に |
| **コスト・並行性の制御** | モデルルーティング（高推論→`opus`、単純→軽量）、並行性 cap（デフォルト 3／最大 5）・バックプレッシャー、外部レビュー予算（変更がなければ skip）、smoke／full のテストモードで大規模 fan-out のコストを抑制 |
| **ループ自己評価** | ループごとに `loop_scorecard.json`（整合度・判定分布・正規化ラウンド・コスト）を算出。**現在は測定ロギングのみ active**、提案→自動の還流は実験段階。anti-Goodhart ガード（指標の操作・過学習の防止） |

### 2 層品質ゲート（コード／設計ドメイン）

内部 QA は同じセッション・同じコンテキストのため **同じ盲点** を共有します。そこで外部の独立 AI レビューを別の軸として設けます。

- **エンジンの多様性** — レビュアーはランナーエンジンを **除外** して選択（同じエンジン＝同じ盲点）。Claude Code 実行時は `codex`＋`agy`、Codex 実行時は `claude`＋`agy`。（`agy` = Gemini モデル）
- **全件の直接判定** — 外部レビュアーは設計上の決定・凍結された契約・実測値を知らないため、報告された課題をオーケストレーターが **実コードと照合** して確認／部分／繰越／棄却で判定。合意＝正解ではなく、判定の権威はオーケストレーター（委譲禁止）。
- **収束ループ** — loop-until-dry（新規 0 件が K 回連続）+ ラウンド cap、判定台帳（`verdicts.json`、再出現防止）、修正版の再レビュー。確認分のみ TDD で修正。
- **ツール不在時はスキップ** — `check-review-tools.sh` がランナー除外の `REVIEWERS:` を算出し、外部レビュアーがいなければゲートを内部 QA に縮小（動作不能なスキルを防止）。

> この README もこのゲートで検証されています — `codex`（整合性）+ `agy`（性能・安定性）の外部監査を経てコミット。

## 動作原理 — スキル ↔ エージェント

生成されたハーネスは **誰が（who）** と **どのように（how）** を分離します：

- **エージェント = 誰が** — 専門家ペルソナ + 作業原則。`.claude/agents/{name}.md` ファイルで定義（インライン禁止 → セッション間で再利用）。1 エージェント = 1 役割。
- **スキル = どのように** — 手順 + バンドルされたツール。`skills/{name}/SKILL.md`。1 エージェントが 1〜N 個のスキルを使用（共有可能）。
- **オーケストレーター = 誰が・いつ・どの順序で** — 個々のエージェント／スキルを 1 つのワークフローへ束ねる。
- **データの受け渡し** — メッセージ（リアルタイム調整）+ 共有タスクリスト（進捗追跡）+ ファイル（`_workspace/`、大容量・監査証跡）。成果物の `## 次のステップ参照` ブロックで段階間の判断の連続性を維持。
- **Why 優先・DRY ポインタ** — 「ALWAYS／NEVER」の強制ではなく *理由* を説明（エッジケースの判断力↑）、単一の出典を参照（重複禁止）。

> 一言で言えば：**オーケストレーター** が誰が／いつ／順序を決め、**エージェント** が誰が、**スキル** がどのように、**2 層ゲート** が品質を守る。

### 7 ステップワークフロー

```
Phase 0  現状監査 (既存ハーネスの drift 点検 · 新規/拡張/保守/更新へ分岐)
Phase 1  ドメイン分析 (作業タイプ · 既存資産との衝突 · ユーザー習熟度の検知)
Phase 2  チームアーキテクチャ設計 (実行モード + 6 パターンから選択)
Phase 3  エージェント定義の生成 (.claude/agents/ · 教義の注入)
Phase 4  スキルの生成 (.claude/skills/ · Progressive Disclosure)
Phase 5  統合・オーケストレーション (+ 2 層品質ゲート · デュアルランタイム出力 · CLAUDE.md ポインタ)
Phase 6  検証・テスト (トリガー検証 · ドライラン · with/without 比較)
Phase 7  ハーネスの進化 (フィードバック還流 · ランタイム同期 · ビルド済みハーネスの更新)
```

> **まず読む：** `skills/myharness/references/factory-map.md` — ドメイン／リスク別の最小経路マップ。**基本はスリム** — 外部レビュー・TDD・評価はリスクが上がったときだけ有効化します（単純なハーネスへの過負担を防止）。

## 実行モード & アーキテクチャパターン

| 実行モード | ツール | 適する場面 |
|-----------|------|------|
| **エージェントチーム**（基本） | `Agent`（チームメンバー spawn）+ `SendMessage` + `TaskCreate` | 2 名以上の協業、リアルタイムの調整・フィードバック |
| **サブエージェント** | `Agent` ツールの直接呼び出し（`run_in_background` で並列） | 単発、エージェント間通信が不要 |
| **ハイブリッド** | Phase ごとにチーム／サブを混合 | 段階ごとに特性が異なるとき |

<p align="center">
  <img src="harness_team.png" alt="myharness エージェントチーム" width="500">
</p>

| アーキテクチャパターン | 説明 |
|---------------|------|
| パイプライン | 順次依存するタスク |
| ファンアウト／ファンイン | 並列の独立タスクの後に統合 |
| エキスパートプール | 状況別に選択して呼び出し |
| 生成-検証 | 生成後に品質検収（リトライループ） |
| スーパーバイザー | 中央エージェントが動的にタスクを分配 |
| 階層的委譲 | 上位→下位への再帰的委譲 |

## 生成される成果物

```
your-project/
├── .claude/
│   ├── agents/          # エージェント定義 (analyst.md, builder.md, qa.md …)
│   └── skills/          # スキル (各 SKILL.md + references/)
├── CLAUDE.md            # Claude Code エントリポインタ
└── AGENTS.md            # Codex エントリポインタ (デュアルランタイム時)
```

> **デュアルランタイム出力：** Codex も対象なら `.agents/skills/<name>/`・`.codex/agents/<name>.toml` を `.claude/` の成果物とともに出力（同じ正本）。詳細：`skills/myharness/references/runtime-adapters.md`。

## デュアルランタイム (Claude Code + Codex)

正本（スキル本文・references・スクリプト）は **ランタイム非依存のマークダウン** です。アダプターで分岐するところだけが異なります：

| 関心事 | Claude Code | Codex CLI |
|--------|-------------|-----------|
| エントリポイント | `.claude-plugin/plugin.json` + `CLAUDE.md` | `AGENTS.md`（自動ロード） |
| スキル | `.claude/skills/` | `.agents/skills/`（フォーマット同一） |
| エージェント | `.claude/agents/*.md` | `.codex/agents/*.toml` + 内蔵 worker/explorer |
| オーケストレーション | `Agent` チームメンバー spawn + `SendMessage` + `TaskCreate` | ネイティブ subagents / `codex exec` subprocess |
| 外部レビュアー | codex + agy（ランナー claude を除外） | claude + agy（ランナー codex を除外） |

> `agy`（antigravity、Gemini モデル）はホストランタイムではなく、外部レビュー専用です。詳細：`skills/myharness/references/runtime-adapters.md`。

## 使用例のプロンプト

インストール後、Claude Code（または Codex）にそのまま貼り付けて試してみてください：

**ディープリサーチ**
```
ディープリサーチ用のハーネスを構成して。Web 検索・学術資料・コミュニティの世論など複数の角度から
トピックを調査し、クロスチェックした上で総合レポートを出すエージェントチームが必要。
```

**フルスタック Web 開発**
```
フルスタック Web 開発用のハーネスを作って。デザイン・フロント(React/Next.js)・バックエンド(API)・QA が
ワイヤーフレームからデプロイまでパイプラインで協業するチームがいい。
```

**Webtoon 制作**
```
Webtoon エピソード制作用のハーネス。ストーリー・キャラクタープロンプト・パネルレイアウト・セリフ編集のエージェントが
必要で、互いの結果をスタイル一貫性の観点でレビューさせて。
```

**コードレビュー & リファクタリング**
```
総合コードレビュー用のハーネス。アーキテクチャ・セキュリティ脆弱性・性能ボトルネック・コードスタイルを並列で点検した上で、
すべての発見を 1 つのレポートに統合するチームが欲しい。
```

**データパイプライン設計**
```
データパイプライン設計用のハーネス。スキーマ設計・ETL ロジック・検証ルール・モニタリング設定を
階層的に委譲するエージェントチームが必要。
```

**AIOps — PaaS 運用管理 (Kubernetes)** — *モデルルーティング · スリム経路 · セーフティゲートを一度に示す事例*
```
PaaS 運用管理ハーネスを構成して。
- ドメイン: Kubernetes クラスタの安定運用 (収集→診断→対処→レポート)
- 環境: 単一ノード kind、kubectl context=docker-desktop、metrics-server なし
- エージェント: 状態収集(読み取り)、根本原因診断、対処適用、ヘルスレポート
- リスク: 運用/非コード → スリム経路 (外部レビュー・TDD・評価を省略)
- ランタイム: Claude Code のみ
- モデル: 高推論(診断/対処)=opus、収集=haiku、レポート=sonnet
- セーフティゲート(k8s-remediate スキル本文にバージョン管理された手順として明記):
  変更を適用する前に 5 項目を評価し、すべて PASS の場合のみ適用。一つでも FAIL なら
  中断して人間に引き継ぐ。
    1) Blast radius  2) Rollback  3) Approval  4) Timing  5) Tenant scope
  しきい値は references/thresholds.md に分離(本文に数値を直書きしない)。
```

## プラグイン構造

```
my_harness/
├── .claude-plugin/plugin.json   # マニフェスト (name: myharness)
├── skills/myharness/
│   ├── SKILL.md                 # メインスキル (7 ステップワークフロー)
│   ├── references/              # factory-map · agent-design-patterns · orchestrator-template ·
│   │                            #   external-review-loop · tdd-doctrine · dev-rules ·
│   │                            #   runtime-adapters · harness-update · loop-self-eval など
│   └── scripts/                 # check-review-tools · build-scorecard · harness-update
├── AGENTS.md                    # Codex エントリポイント
├── install.sh                   # デュアルランタイムのインストール
└── README.md / README_KO.md / README_JA.md
```

## エコシステム内の位置づけ

myharness は Claude Code エージェントエコシステムの **メタファクトリー** レイヤー — 他のハーネスを *生成する* 側 — に位置します。隣接するレイヤーとは役割が異なるため、選んで使うことも組み合わせることもできます。

| 隣接 | 相手の役割 | myharness との関係 |
|------|----------|-------------------|
| [coleam00/Archon](https://github.com/coleam00/Archon) | 決定論的・再現可能な **ランタイム構成** ファクトリー | 同じメタレイヤー、異なるサブ領域。Archon＝ランタイムの決定性、myharness＝チームアーキテクチャ。組み合わせ可能（設計は myharness → デプロイは Archon） |
| [LangGraph](https://langchain-ai.github.io/langgraph/) | 状態グラフのオーケストレーション、LLM 非依存 | 異なるトラック。LangGraph＝長時間実行・状態復旧、myharness＝Claude Code ネイティブの高速なチーム設計 |
| [wshobson/agents](https://github.com/wshobson/agents) | サブエージェント／スキルのカタログ | 部品供給 ↔ ファクトリー。カタログから部品を選び、myharness が設計したチームに取り込む |

## コンパニオン: My Harness Web

ビルド済みハーネスを **観測・制御** するローカル Web アプリ。`_workspace/runs/**` のファイル状態を読み、インベントリ・実行・履歴・ドキュメント・drift・評価・ハーネス構成を 1 画面に集約します — CLI では一目で見えないもの。ドメインの一文から **ハーネス全体を自動ビルド** することもできます（ドラフト → 人間レビュー → create）。

- **実行：** `cd harness-ui && npm install && npm start` — ビルド後 `127.0.0.1:5174` を単一オリジンで配信し、ワンタイム（fragment）トークンのリンクでブラウザを開く。開発：`npm run dev`。
- **機能：** v0.5 正本コア（supervisor · OS アダプター · セキュリティ · ランチャー）+ v0.6 全機能（F2 プリフィル New Run · F3 projectRoot 編集 · F4 履歴 · F5 ドキュメント/artifact ビューア · F6 観測性 · F7 定義エディタ · F8 Eval ダッシュボード · F9 Docs ソース · F10 マルチランタイムコンテキスト）+ **config-centric 自己評価**（harness_scorecard · 採用段階ゲート）+ **ハーネス全体の自動ビルド**。
- **画面（11 · グループサイドバー）：** Overview · **Harness** / Agents / Skills / Context / History · Docs · Runs / Drift / Ops / Eval · Settings。フロー：ドメイン → Harness 自動ビルド（ドラフト → create）または New Run → run 生成 → 観測（fire-and-observe）。
- **セキュリティ・範囲：** ローカル 127.0.0.1 のみ · トークン bootstrap → セッション · 読み取り優先（mutating は定義編集・projectRoot・評価 config・ハーネスビルドのみ — ホワイトリスト・アトミック・既定 off ゲート、自動ビルドは no-tools isolated exec + no-auto-apply）。履歴・統計は **UI で実行した run のみ** 反映、ターミナル CLI 実行は v0.7（CLI セッションログ観測）まで範囲外。

**詳細ドキュメント**
- アプリパッケージ・開発ガイド → [`harness-ui/README.md`](harness-ui/README.md)
- ドキュメントハブ（設計 · PRD · 受け入れ基準 · 監査履歴） → [`docs/harness-ui/`](docs/harness-ui/README.md)
- v0.6 設計（実装済み） → [`docs/harness-ui/v0.6/design/design-v0.6.md`](docs/harness-ui/v0.6/design/design-v0.6.md) · PRD → [`docs/harness-ui/v0.6/prd/`](docs/harness-ui/v0.6/prd/)
- v0.7 企画（CLI セッションログ観測） → [`docs/harness-ui/v0.7/`](docs/harness-ui/v0.7/)

> ファクトリーとは区別されるサブプロジェクト：ファクトリーはハーネスを *生成* し、My Harness Web は 1 つを *運用* します（自動ビルドも可能）。自身のバージョンライン（v0.5/0.6）は上記のファクトリーバージョンとは別です。

## 要件

- **Claude Code：** [エージェントチームの有効化](https://code.claude.com/docs/en/agent-teams) — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **外部レビュー（任意）：** `codex`／`claude`／`agy` CLI のうち、ランナーを除いた 1 つ以上（`agy` がなければ `gemini` legacy フォールバック、すべて無ければゲート自動スキップ）

> **⚠️ コスト注意：** エージェントチームはチームメンバーごとに独立した Claude インスタンスのため、並列／共有コンテキストの構造上 **単一プロンプトと比べて API トークンコストが急増** することがあります。コストに敏感な環境ではサブエージェントモードを使う（`run_in_background` の結果のみ返す）か、エージェントチームを無効化してください。myharness はモデルルーティング・並行性 cap・外部レビュー予算でこれを緩和します。
>
> **既知の制限（experimental）：** エージェントチームは Claude Code の実験的機能です。`--resume` 未復元、task status の遅延、tmux モードのゾンビプロセスなどの制限があるため — myharness は中間成果物を `_workspace/` にチェックポイントとして残し、完了報告を `SendMessage` で要求し、終了時には明示的な shutdown を求めるよう設計します。詳細：`skills/myharness/references/agent-design-patterns.md`。

## FAQ

<details>
<summary><b>Q1. どのランタイムをサポートしていますか？</b></summary>

**A.** Claude Code と Codex の両方（デュアルランタイム）。単一の正本（`skills/myharness/`）+ ランタイム別の薄いアダプター。Claude Code が最も自動化された主ランタイム（`Agent` チームメンバー spawn）、Codex は `AGENTS.md` + `.agents/skills/` + ネイティブ subagents / `codex exec` でサポート（`$myharness` または `/skills`）。Gemini はホストではなく外部レビュアー（agy 経由）としてのみ使用。詳細：`skills/myharness/references/runtime-adapters.md`。
</details>

<details>
<summary><b>Q2. すべての作業で重いゲートが全部有効になりますか？</b></summary>

**A.** いいえ。**基本はスリム** です。単純／非コード／可逆な作業は内部 QA のみ、コード／設計の標準は外部レビュー 1 回、契約変更・不可逆な重大作業のみ各段階で外部レビュー + 承認ラダー。リスク等級で強度を合わせます（`skills/myharness/references/factory-map.md`）。
</details>

<details>
<summary><b>Q3. ファクトリーを更新すると、自分で手を入れたハーネスが上書きされますか？</b></summary>

**A.** いいえ。`/myharness update` は `.harness-manifest.json` のハッシュでファイルを分類し、USER-MODIFIED は **保留**（明示的に承認したときのみ置換、部分マージなし）します。ユーザーのポリシーは `*.local.*` ファイルに分離すれば更新も安全。詳細：`skills/myharness/references/harness-update.md`。
</details>

## ライセンス

Apache 2.0
