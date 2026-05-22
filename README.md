# 🧩 block-chat — エディタ

> AIと話しながら、ブロックが組み上がる Scratch エディタ。

block-chat は、子どもが日本語で「こうしたい」と話すと、それを Scratch の
ブロックに変換し、エディタへ**ライブ注入**する学習ツールです。
このリポジトリは [Scratch（scratch-gui）](https://github.com/scratchfoundation/scratch-gui)
を**フォーク**し、バックパックの位置に **AIチャットパネル**を組み込んだエディタです。

![Scratch 3.0](https://img.shields.io/badge/Scratch%203.0-fork-ff8c1a.svg?style=flat-square)
![React](https://img.shields.io/badge/React-scratch--gui-61dafb.svg?style=flat-square)
![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)

---

## 🧱 2つのリポジトリ

block-chat は2つのリポジトリで構成されます。

| リポジトリ | 役割 |
|---|---|
| **block-chat-gui**（このリポジトリ） | フォークした Scratch エディタ＋AIチャットパネル |
| [**block-chat-backend**](https://github.com/masafykun/block-chat-backend) | 自然言語の解釈・ブロック生成（IRコンパイラ＋AIエージェント） |

🔗 **バックエンド（自然言語→ブロックの変換）はこちら → [block-chat-backend](https://github.com/masafykun/block-chat-backend)**

このエディタ単体では会話機能は動きません。`block-chat-backend` を起動して接続する必要があります。

---

## ✨ 特徴

- **AIチャットパネル** — バックパックの位置に配置。上端ドラッグで高さを変えられる
- **ライブ注入** — 会話で決まったブロックが、編集中のスプライトに即座に生える
- **素の Scratch そのまま** — ブロックパレットも手動編集も通常どおり使える
- **Scratch のフォーク** — `scratch-gui` を改造。コア機能は upstream に追従

---

## 🛠️ 技術スタック

| カテゴリ | 技術 |
|---|---|
| ベース | Scratch 3.0（scratch-gui のフォーク） |
| UI | React / Redux |
| ブロック描画 | scratch-blocks（Blockly 派生） |
| 実行エンジン | scratch-vm |

---

## 🧩 block-chat の改造点

素の scratch-gui に対して、以下を追加・変更しています。

| パス | 内容 |
|---|---|
| `src/components/ai-panel/` | AIチャットパネル（表示・スタイル）※新規 |
| `src/containers/ai-panel.jsx` | 会話状態・バックエンド呼び出し・リサイズ ※新規 |
| `src/lib/ai-block-injector.js` | sb3→ランタイム形式変換＋ライブ注入 ※新規 |
| `src/components/gui/gui.jsx` | バックパックを AIパネルに差し替え ※変更 |

---

## 🚀 セットアップ

```bash
npm install      # 依存パッケージを導入（scratch-vm/blocks 等を含む・大きめ）
npm start        # 開発サーバー起動（http://localhost:8601）
```

会話機能を使うには、別途 [block-chat-backend](https://github.com/masafykun/block-chat-backend)
を起動しておくこと。フロントは既定で `http://localhost:8000/api/chat` を呼ぶ。

---

## ライセンス

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](https://www.gnu.org/licenses/agpl-3.0)

このプロジェクトは **GNU AGPL-3.0** のもとで公開しています。
改造して配布・ネットワーク提供する場合は、全ソースコードの公開が必要です。

フォーク元の Scratch（scratch-gui）は Scratch Foundation の著作物です。
Scratch は MIT Media Lab の Lifelong Kindergarten グループのプロジェクトです（https://scratch.mit.edu）。

© 2026 masafykun (https://github.com/masafykun)
