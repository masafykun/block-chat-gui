/**
 * block-chat: バックエンドが返したブロックを編集中のスプライトにライブ注入する。
 *
 * バックエンドは sb3形式のブロックJSONを返す。scratch-vm の shareBlocksToTarget は
 * ランタイム形式を要求するが、scratch-vm は内部モジュール(serialization/sb3)を
 * exports で公開していないため import できない。
 * そこで sb3 -> ランタイム形式の変換を、scratch-vm の deserialize ロジックを
 * 忠実に移植する形でここに自前実装する（sb3ブロック形式は安定した仕様）。
 */

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

/**
 * バックエンド応答のブロックを編集中スプライトへライブ注入する。
 * @param {VM} vm scratch-vm インスタンス
 * @param {object} payload {blocks, variables, broadcasts}
 * @returns {Promise} 注入完了で解決
 */
const injectBlocks = function (vm, payload) {
    const blocks = payload && payload.blocks;
    if (!blocks || Object.keys(blocks).length === 0) {
        return Promise.resolve();
    }
    const target = vm.editingTarget;
    if (!target) {
        return Promise.reject(new Error('編集中のスプライトがありません'));
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

    // 編集中スプライトへ注入。shareBlocksToTarget が ID 再採番（既存ブロックとの
    // 衝突回避）と拡張機能の自動ロードを行う。
    return vm.shareBlocksToTarget(Object.values(dict), target.id)
        .then(() => vm.refreshWorkspace());
};

export default injectBlocks;
