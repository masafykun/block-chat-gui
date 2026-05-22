/**
 * block-chat: バックエンドが返したブロックを編集中のスプライトにライブ注入する。
 *
 * バックエンドは sb3形式のブロックJSONを返す。scratch-vm の shareBlocksToTarget は
 * ランタイム形式を要求するが、scratch-vm は内部モジュール(serialization/sb3)を
 * exports で公開していないため import できない。
 * そこで sb3 -> ランタイム形式の変換を、scratch-vm の deserialize ロジックを
 * 忠実に移植する形でここに自前実装する（sb3ブロック形式は安定した仕様）。
 *
 * v3: Scratch標準ライブラリからのスプライト追加・背景変更にも対応。
 */
import spriteLibrary from './libraries/sprites.json';
import backdropLibrary from './libraries/backdrops.json';
import randomizeSpritePosition from './randomize-sprite-position';

// sb3 入力の shadow フラグ
const INPUT_SAME_BLOCK_SHADOW = 1;   // block と shadow が同一
const INPUT_BLOCK_NO_SHADOW = 2;     // block のみ（真偽・サブスタック）
// 3 = INPUT_DIFF_BLOCK_SHADOW       // block と shadow が別

// scratch-vm Variable の型定数
const SCALAR_TYPE = '';
const LIST_TYPE = 'list';
const BROADCAST_TYPE = 'broadcast_msg';

let uidCounter = 0;
const uid = () =>
    `bc-${Date.now().toString(36)}-${++uidCounter}-${Math.random().toString(36).slice(2, 8)}`;

// sb3 プリミティブ [type, value, ...] -> ランタイムのプリミティブブロック仕様
const PRIMITIVE = {
    4:  v => ({opcode: 'math_number',          fields: {NUM: {name: 'NUM', value: v[1]}}}),
    5:  v => ({opcode: 'math_positive_number', fields: {NUM: {name: 'NUM', value: v[1]}}}),
    6:  v => ({opcode: 'math_whole_number',    fields: {NUM: {name: 'NUM', value: v[1]}}}),
    7:  v => ({opcode: 'math_integer',         fields: {NUM: {name: 'NUM', value: v[1]}}}),
    8:  v => ({opcode: 'math_angle',           fields: {NUM: {name: 'NUM', value: v[1]}}}),
    9:  v => ({opcode: 'colour_picker',        fields: {COLOUR: {name: 'COLOUR', value: v[1]}}}),
    10: v => ({opcode: 'text',                 fields: {TEXT: {name: 'TEXT', value: v[1]}}}),
    11: v => ({opcode: 'event_broadcast_menu', fields: {BROADCAST_OPTION:
        {name: 'BROADCAST_OPTION', value: v[1], id: v[2], variableType: BROADCAST_TYPE}}}),
    12: v => ({opcode: 'data_variable',        fields: {VARIABLE:
        {name: 'VARIABLE', value: v[1], id: v[2], variableType: SCALAR_TYPE}}}),
    13: v => ({opcode: 'data_listcontents',    fields: {LIST:
        {name: 'LIST', value: v[1], id: v[2], variableType: LIST_TYPE}}})
};

/**
 * 入力記述子（プリミティブ配列 or ブロックid）を解決する。
 * 配列ならプリミティブブロックを生成して blocks に登録し、その id を返す。
 */
const deserializeInputDesc = (desc, parentId, isShadow, blocks) => {
    if (!Array.isArray(desc)) return desc; // 既にブロックid
    const make = PRIMITIVE[desc[0]];
    if (!make) return null;
    const id = uid();
    const spec = make(desc);
    blocks[id] = {
        id: id,
        opcode: spec.opcode,
        next: null,
        parent: parentId,
        inputs: {},
        fields: spec.fields,
        shadow: isShadow,
        topLevel: false
    };
    return id;
};

/** sb3 inputs（配列形式）-> ランタイム inputs（{name, block, shadow}） */
const deserializeInputs = (inputs, parentId, blocks) => {
    const obj = {};
    for (const name in inputs) {
        const arr = inputs[name];
        if (!Array.isArray(arr)) continue;
        let block = null;
        let shadow = null;
        if (arr[0] === INPUT_SAME_BLOCK_SHADOW) {
            block = shadow = deserializeInputDesc(arr[1], parentId, true, blocks);
        } else if (arr[0] === INPUT_BLOCK_NO_SHADOW) {
            block = deserializeInputDesc(arr[1], parentId, false, blocks);
        } else {
            block = deserializeInputDesc(arr[1], parentId, false, blocks);
            shadow = deserializeInputDesc(arr[2], parentId, true, blocks);
        }
        obj[name] = {name: name, block: block, shadow: shadow};
    }
    return obj;
};

/** sb3 fields（配列形式）-> ランタイム fields（{name, value, id?, variableType?}） */
const deserializeFields = fields => {
    const obj = {};
    for (const name in fields) {
        const arr = fields[name];
        if (!Array.isArray(arr)) continue;
        obj[name] = {name: name, value: arr[0]};
        if (arr.length > 1) obj[name].id = arr[1];
        if (name === 'BROADCAST_OPTION') obj[name].variableType = BROADCAST_TYPE;
        else if (name === 'VARIABLE') obj[name].variableType = SCALAR_TYPE;
        else if (name === 'LIST') obj[name].variableType = LIST_TYPE;
    }
    return obj;
};

/** sb3形式のブロック辞書 -> ランタイム形式（破壊的に変換） */
const deserializeBlocks = blocks => {
    // 元のキーだけを走査（変換中に生成されるプリミティブブロックは対象外）
    for (const blockId of Object.keys(blocks)) {
        const block = blocks[blockId];
        if (Array.isArray(block)) {
            delete blocks[blockId];
            deserializeInputDesc(block, null, false, blocks);
            continue;
        }
        block.id = blockId;
        block.inputs = deserializeInputs(block.inputs, blockId, blocks);
        block.fields = deserializeFields(block.fields);
    }
    return blocks;
};

/** 既存スクリプトの削除と、新しいブロックの注入（IR v2 相当）。 */
const applyScripts = function (vm, target, payload) {
    // 1. 既存スクリプトの削除。deleteBlock は next連鎖・サブスタック・入力ブロックまで
    //    再帰削除する。「更新」は古いスクリプトがここで消えることで成立する。
    const deletes = (payload && payload.deletes) || [];
    deletes.forEach(id => {
        if (target.blocks.getBlock(id)) {
            target.blocks.deleteBlock(id);
        }
    });

    // 2. 新しいブロックの追加
    const blocks = payload && payload.blocks;
    if (!blocks || Object.keys(blocks).length === 0) {
        vm.refreshWorkspace(); // 削除のみ・スプライト追加のみでも再描画する
        return Promise.resolve();
    }
    const stage = vm.runtime.getTargetForStage();

    // 変数・メッセージを先に（ステージにグローバルで）作る。
    // idはコンパイラの採番をそのまま使い、ブロック側のフィールド参照と一致させる。
    const variables = payload.variables || {};
    const broadcasts = payload.broadcasts || {};
    Object.keys(variables).forEach(name => {
        stage.createVariable(variables[name], name, SCALAR_TYPE);
    });
    Object.keys(broadcasts).forEach(name => {
        stage.createVariable(broadcasts[name], name, BROADCAST_TYPE);
    });

    // sb3形式 -> ランタイム形式（コピーを破壊的に変換）
    const dict = JSON.parse(JSON.stringify(blocks));
    deserializeBlocks(dict);

    // shareBlocksToTarget が ID 再採番（既存ブロックとの衝突回避）と拡張機能の
    // 自動ロードを行う。
    return vm.shareBlocksToTarget(Object.values(dict), target.id)
        .then(() => vm.refreshWorkspace());
};

const SPRITE_TIMEOUT_MS = 12000;

// promise がタイムアウトしたら reject する（addSprite のハング検知用）。
const withTimeout = function (promise, ms, label) {
    return Promise.race([
        Promise.resolve(promise),
        new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error(label + 'がタイムアウトしました')), ms);
        })
    ]);
};

/**
 * バックエンド応答を編集中プロジェクトへライブ反映する（IR v3）。
 * 背景の変更・スプライトの追加・スクリプトの削除/追加を行う。
 * @param {VM} vm scratch-vm インスタンス
 * @param {object} payload {backdrop, sprites, deletes, blocks, variables, broadcasts}
 * @returns {Promise<{notes: string[]}>} 反映完了で解決。notes は利用者へ伝える注意書き。
 */
const injectBlocks = function (vm, payload) {
    const target = vm.editingTarget;
    if (!target) {
        return Promise.reject(new Error('編集中のスプライトがありません'));
    }
    const notes = [];

    // --- 1. スクリプト（最重要）を先に注入する ---
    const scriptsResult = applyScripts(vm, target, payload);

    // --- 2. 背景の変更 ---
    try {
        const bd = payload && payload.backdrop;
        if (bd && bd.library) {
            const entry = backdropLibrary.find(b => b.name === bd.library);
            if (entry) {
                vm.addBackdrop(entry.md5ext, {
                    name: entry.name,
                    rotationCenterX: entry.rotationCenterX,
                    rotationCenterY: entry.rotationCenterY,
                    bitmapResolution: entry.bitmapResolution,
                    skinId: null
                });
            } else {
                notes.push(`背景「${bd.library}」はライブラリに見つかりませんでした`);
            }
        }
    } catch (e) {
        notes.push(`背景の追加に失敗しました（${(e && e.message) || e}）`);
    }

    // --- 3. スプライトの追加（タイムアウト付き・結果を notes に集める）---
    const spriteJobs = ((payload && payload.sprites) || []).map(sp => {
        const lib = sp && sp.library;
        const found = spriteLibrary.find(s => s.name === lib);
        if (!found) {
            notes.push(`スプライト「${lib}」はライブラリに見つかりませんでした`);
            return Promise.resolve();
        }
        // ライブラリ項目には x/y 座標が無い。本家と同様 randomizeSpritePosition で与える。
        // さらに sounds を空にする：ライブラリスプライトの音(pop音等)の読み込みが
        // この環境では AudioContext 停止のためハングし addSprite が完了しないため。
        // 絵(costumes)さえあればスプライトとして十分。
        const entry = Object.assign({}, found);
        entry.sounds = [];
        randomizeSpritePosition(entry);
        return withTimeout(vm.addSprite(JSON.stringify(entry)), SPRITE_TIMEOUT_MS,
            `スプライト「${lib}」の追加`)
            .catch(e => {
                const msg = (e && e.message) || String(e);
                notes.push(`スプライト「${lib}」を追加できませんでした（${msg}）`);
                console.error('block-chat: addSprite失敗', lib, e);
            });
    });

    return Promise.all([scriptsResult].concat(spriteJobs)).then(() => ({notes: notes}));
};

export default injectBlocks;
