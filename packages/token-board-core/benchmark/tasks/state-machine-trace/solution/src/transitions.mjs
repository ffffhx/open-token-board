/**
 * 自动售货机状态机的迁移表。
 *
 * 结构：{ [当前状态]: { [事件]: 目标状态 | (context) => 目标状态 } }
 *
 * context 包含：
 *   - balance: number   已投入金额（分）
 *   - price:   number   所选商品价格（分），未选时为 0
 */
export const transitions = {
  IDLE: {
    SELECT:  (ctx) => ctx.balance >= ctx.price ? 'PAYING'    : 'SELECTING',
    INSERT:  'SELECTING',
    CANCEL:  'IDLE',
  },
  SELECTING: {
    SELECT:  (ctx) => ctx.balance >= ctx.price ? 'PAYING'    : 'SELECTING',
    INSERT:  'SELECTING',
    CANCEL:  'REFUNDING',
    TIMEOUT: 'REFUNDING',
  },
  PAYING: {
    CONFIRM: 'DISPENSING',
    CANCEL:  'REFUNDING',
    TIMEOUT: 'REFUNDING',
  },
  DISPENSING: {
    DONE:    'IDLE',
    ERROR:   'ERROR',
  },
  REFUNDING: {
    DONE:    'IDLE',
    ERROR:   'ERROR',
  },
  ERROR: {
    RESET:   'IDLE',
  },
};
