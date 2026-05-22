/**
 * block-chat: 編集中スプライトの既存スクリプトを、AIに渡せる要約へ変換する。
 *
 * バックエンドへ [{id, outline}] を送ることで、AIが「今ある物」を踏まえて
 * 追加・削除・更新を判断できる（IR v2）。id は削除対象の指定に使われる。
 */

// 引数を取らない単純ブロックの opcode -> ラベル
const SIMPLE = {
    event_whenflagclicked: '🏴旗が押されたとき',
    event_whenthisspriteclicked: 'スプライトが押されたとき',
    control_start_as_clone: 'クローンされたとき',
    motion_ifonedgebounce: 'もし端に着いたら跳ね返る',
    looks_nextcostume: '次のコスチュームにする',
    looks_show: '表示する',
    looks_hide: '隠す',
    sound_stopallsounds: 'すべての音を止める',
    control_delete_this_clone: 'このクローンを削除する'
};

const NUM_OPS = new Set([
    'math_number', 'math_positive_number', 'math_whole_number',
    'math_integer', 'math_angle'
]);

// 入力スロットの中身を短いテキストにする（数値・文字列・変数はそのまま、他は「式」）
const shadowText = (blocks, b, name) => {
    const input = b.inputs[name];
    if (!input || !input.block) return '?';
    const inner = blocks.getBlock(input.block);
    if (!inner) return '?';
    if (NUM_OPS.has(inner.opcode) && inner.fields.NUM) return String(inner.fields.NUM.value);
    if (inner.opcode === 'text' && inner.fields.TEXT) return String(inner.fields.TEXT.value);
    if (inner.opcode === 'data_variable' && inner.fields.VARIABLE) {
        return String(inner.fields.VARIABLE.value);
    }
    return '式';
};

const fieldText = (b, name) => (b.fields[name] ? String(b.fields[name].value) : '');

// 前方宣言（describeBlock と相互再帰）
let describeStack;

const describeBlock = (blocks, b) => {
    const op = b.opcode;
    if (SIMPLE[op]) return SIMPLE[op];
    const sub = name => describeStack(blocks, (b.inputs[name] || {}).block);

    switch (op) {
    case 'event_whenkeypressed':   return `${fieldText(b, 'KEY_OPTION')}キーが押されたとき`;
    case 'event_whenbroadcastreceived':
        return `「${fieldText(b, 'BROADCAST_OPTION')}」を受け取ったとき`;
    case 'control_forever':        return `ずっと[ ${sub('SUBSTACK')} ]`;
    case 'control_repeat':         return `${shadowText(blocks, b, 'TIMES')}回くりかえす[ ${sub('SUBSTACK')} ]`;
    case 'control_if':             return `もし〜なら[ ${sub('SUBSTACK')} ]`;
    case 'control_if_else':        return `もし〜なら[ ${sub('SUBSTACK')} ]でなければ[ ${sub('SUBSTACK2')} ]`;
    case 'control_repeat_until':   return `〜までくりかえす[ ${sub('SUBSTACK')} ]`;
    case 'control_wait_until':     return '〜まで待つ';
    case 'control_wait':           return `${shadowText(blocks, b, 'DURATION')}秒待つ`;
    case 'control_stop':           return 'スクリプトを止める';
    case 'control_create_clone_of':return 'クローンを作る';
    case 'motion_movesteps':       return `${shadowText(blocks, b, 'STEPS')}歩動かす`;
    case 'motion_turnright':       return `右に${shadowText(blocks, b, 'DEGREES')}度回す`;
    case 'motion_turnleft':        return `左に${shadowText(blocks, b, 'DEGREES')}度回す`;
    case 'motion_gotoxy':          return `x:${shadowText(blocks, b, 'X')} y:${shadowText(blocks, b, 'Y')}へ行く`;
    case 'motion_glidesecstoxy':   return `${shadowText(blocks, b, 'SECS')}秒でxyへ行く`;
    case 'motion_pointindirection':return `${shadowText(blocks, b, 'DIRECTION')}度に向ける`;
    case 'motion_changexby':       return `xを${shadowText(blocks, b, 'DX')}変える`;
    case 'motion_setx':            return `xを${shadowText(blocks, b, 'X')}にする`;
    case 'motion_changeyby':       return `yを${shadowText(blocks, b, 'DY')}変える`;
    case 'motion_sety':            return `yを${shadowText(blocks, b, 'Y')}にする`;
    case 'looks_say':              return `「${shadowText(blocks, b, 'MESSAGE')}」と言う`;
    case 'looks_sayforsecs':       return `「${shadowText(blocks, b, 'MESSAGE')}」と${shadowText(blocks, b, 'SECS')}秒言う`;
    case 'looks_think':
    case 'looks_thinkforsecs':     return `「${shadowText(blocks, b, 'MESSAGE')}」と考える`;
    case 'looks_switchcostumeto':  return 'コスチュームを変える';
    case 'looks_changesizeby':     return `大きさを${shadowText(blocks, b, 'CHANGE')}変える`;
    case 'looks_setsizeto':        return `大きさを${shadowText(blocks, b, 'SIZE')}%にする`;
    case 'looks_seteffectto':
    case 'looks_changeeffectby':   return '画面の効果を変える';
    case 'sound_play':
    case 'sound_playuntildone':    return '音を鳴らす';
    case 'event_broadcast':
    case 'event_broadcastandwait': return 'メッセージを送る';
    case 'data_setvariableto':     return `変数「${fieldText(b, 'VARIABLE')}」を ${shadowText(blocks, b, 'VALUE')} にする`;
    case 'data_changevariableby':  return `変数「${fieldText(b, 'VARIABLE')}」を ${shadowText(blocks, b, 'VALUE')} 変える`;
    default:                       return op;
    }
};

// next 連鎖をたどって ' › ' でつなぐ
describeStack = (blocks, startId) => {
    const parts = [];
    let id = startId;
    let guard = 0;
    while (id && guard < 300) {
        const b = blocks.getBlock(id);
        if (!b) break;
        parts.push(describeBlock(blocks, b));
        id = b.next;
        guard += 1;
    }
    return parts.join(' › ');
};

/**
 * 編集中スプライトの既存スクリプト一覧を [{id, outline}] で返す。
 * @param {VM} vm scratch-vm インスタンス
 * @returns {Array<{id: string, outline: string}>}
 */
const collectExistingScripts = function (vm) {
    const target = vm && vm.editingTarget;
    if (!target || !target.blocks || !target.blocks.getScripts) return [];
    const blocks = target.blocks;
    return blocks.getScripts().map(id => ({
        id: id,
        outline: describeStack(blocks, id)
    }));
};

export default collectExistingScripts;
