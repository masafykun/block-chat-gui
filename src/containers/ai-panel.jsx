import React from 'react';
import PropTypes from 'prop-types';
import bindAll from 'lodash.bindall';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import AIPanelComponent from '../components/ai-panel/ai-panel.jsx';
import injectBlocks from '../lib/ai-block-injector';

// バックエンドのURL。window.BLOCK_CHAT_BACKEND で上書き可（再ビルド不要）。
const BACKEND_URL = (typeof window !== 'undefined' && window.BLOCK_CHAT_BACKEND) ||
    'http://localhost:8000';

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 540;

/**
 * block-chat: AIチャットパネルのロジック。
 * 会話状態を持ち、バックエンドを叩き、返ってきたブロックを VM に注入する。
 */
class AIPanel extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleInputChange',
            'handleInputKeyDown',
            'handleSend',
            'handleResizeMouseDown',
            'handleResizeMouseMove',
            'handleResizeMouseUp',
            'setMessagesRef'
        ]);
        this.state = {
            messages: [],
            inputValue: '',
            isLoading: false,
            height: 220
        };
        this.messagesEl = null;
        this.resizeStartY = 0;
        this.resizeStartHeight = 0;
    }
    componentWillUnmount () {
        this.detachResizeListeners();
    }
    setMessagesRef (el) {
        this.messagesEl = el;
    }
    scrollToBottom () {
        if (this.messagesEl) {
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }
    }
    appendAssistant (content) {
        this.setState(
            prev => ({messages: prev.messages.concat({role: 'assistant', content})}),
            this.scrollToBottom
        );
    }
    handleInputChange (e) {
        this.setState({inputValue: e.target.value});
    }
    handleInputKeyDown (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSend();
        }
    }
    handleSend () {
        const text = this.state.inputValue.trim();
        if (!text || this.state.isLoading) return;

        const history = this.state.messages.concat({role: 'user', content: text});
        this.setState({messages: history, inputValue: '', isLoading: true}, this.scrollToBottom);

        fetch(`${BACKEND_URL}/api/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                messages: history.map(m => ({role: m.role, content: m.content}))
            })
        })
            .then(res => res.json())
            .then(data => {
                this.setState({isLoading: false});
                this.appendAssistant(data.reply || '(返事がありませんでした)');
                if (data.errors && data.errors.length > 0) {
                    this.appendAssistant(`うまく作れませんでした: ${data.errors.join(', ')}`);
                    return;
                }
                if (data.blocks && Object.keys(data.blocks).length > 0) {
                    injectBlocks(this.props.vm, data)
                        .catch(err => this.appendAssistant(`注入に失敗しました: ${err.message}`));
                }
            })
            .catch(err => {
                this.setState({isLoading: false});
                this.appendAssistant(`エラー: バックエンドに接続できませんでした (${err.message})`);
            });
    }
    // --- 高さリサイズ（上端ハンドルを上にドラッグで拡大） ---
    handleResizeMouseDown (e) {
        this.resizeStartY = e.clientY;
        this.resizeStartHeight = this.state.height;
        window.addEventListener('mousemove', this.handleResizeMouseMove);
        window.addEventListener('mouseup', this.handleResizeMouseUp);
        e.preventDefault();
    }
    handleResizeMouseMove (e) {
        const delta = this.resizeStartY - e.clientY; // 上ドラッグで正
        const height = Math.max(MIN_HEIGHT,
            Math.min(MAX_HEIGHT, this.resizeStartHeight + delta));
        this.setState({height});
        // ブロックワークスペース(Blockly)を高さ変化に追従させる
        window.dispatchEvent(new Event('resize'));
    }
    handleResizeMouseUp () {
        this.detachResizeListeners();
    }
    detachResizeListeners () {
        window.removeEventListener('mousemove', this.handleResizeMouseMove);
        window.removeEventListener('mouseup', this.handleResizeMouseUp);
    }
    render () {
        return (
            <AIPanelComponent
                height={this.state.height}
                inputValue={this.state.inputValue}
                isLoading={this.state.isLoading}
                messages={this.state.messages}
                messagesRef={this.setMessagesRef}
                onInputChange={this.handleInputChange}
                onInputKeyDown={this.handleInputKeyDown}
                onResizeMouseDown={this.handleResizeMouseDown}
                onSend={this.handleSend}
            />
        );
    }
}

AIPanel.propTypes = {
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = state => ({
    vm: state.scratchGui.vm
});

export default connect(mapStateToProps)(AIPanel);
