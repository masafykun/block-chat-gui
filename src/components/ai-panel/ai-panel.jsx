import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import styles from './ai-panel.css';

/**
 * block-chat: AIチャットパネル（表示専用）。
 * バックパックがあった位置に置かれ、上端ドラッグで高さを変えられる。
 */
const AIPanelComponent = props => {
    const {
        messages,
        inputValue,
        isLoading,
        height,
        messagesRef,
        onInputChange,
        onInputKeyDown,
        onSend,
        onResizeMouseDown
    } = props;

    return (
        <div
            className={styles.aiPanel}
            style={{height: `${height}px`}}
        >
            <div
                className={styles.resizeHandle}
                onMouseDown={onResizeMouseDown}
            />
            <div className={styles.header}>
                <span className={styles.title}>{'🤖 AIチャット'}</span>
                <span className={styles.hint}>{'作りたいことを話しかけてね'}</span>
            </div>
            <div
                className={styles.messages}
                ref={messagesRef}
            >
                {messages.length === 0 ? (
                    <div className={styles.empty}>
                        {'例:「ねこを旗で10歩ずつずっと動かして」'}
                    </div>
                ) : messages.map((m, i) => (
                    <div
                        key={i}
                        className={classNames(styles.message, styles[m.role])}
                    >
                        {m.content}
                    </div>
                ))}
                {isLoading && (
                    <div className={classNames(styles.message, styles.assistant)}>
                        {'考えています…'}
                    </div>
                )}
            </div>
            <div className={styles.inputRow}>
                <input
                    className={styles.input}
                    type="text"
                    placeholder="作りたいことを書いて Enter"
                    value={inputValue}
                    disabled={isLoading}
                    onChange={onInputChange}
                    onKeyDown={onInputKeyDown}
                />
                <button
                    className={styles.sendButton}
                    disabled={isLoading || !inputValue.trim()}
                    onClick={onSend}
                >
                    {'送信'}
                </button>
            </div>
        </div>
    );
};

AIPanelComponent.propTypes = {
    messages: PropTypes.arrayOf(PropTypes.shape({
        role: PropTypes.string,
        content: PropTypes.string
    })),
    inputValue: PropTypes.string,
    isLoading: PropTypes.bool,
    height: PropTypes.number,
    messagesRef: PropTypes.func,
    onInputChange: PropTypes.func,
    onInputKeyDown: PropTypes.func,
    onSend: PropTypes.func,
    onResizeMouseDown: PropTypes.func
};

export default AIPanelComponent;
