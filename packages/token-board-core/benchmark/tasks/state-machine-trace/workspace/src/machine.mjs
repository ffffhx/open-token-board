import { transitions } from './transitions.mjs';

/**
 * 创建一个状态机实例。
 *
 * @param {string} initialState - 初始状态名
 * @param {{ balance: number, price: number }} initialContext - 初始上下文
 * @returns {{ state: string, context: object, dispatch: function }}
 */
export function createMachine(initialState, initialContext) {
  let state = initialState;
  let context = { ...initialContext };

  /**
   * 派发事件，并根据需要更新 context，然后触发迁移。
   *
   * @param {string} event - 事件名
   * @param {object} [payload] - 可选数据
   *   payload.amount  (用于 INSERT 事件) 增加 balance
   *   payload.price   (用于 SELECT 事件) 设置 price
   */
  function dispatch(event, payload = {}) {
    const stateTransitions = transitions[state];
    if (!stateTransitions) return;          // 未知状态，忽略

    // 先更新 context（在查询迁移函数之前）
    if (event === 'INSERT' && typeof payload.amount === 'number') {
      context.balance += payload.amount;
    }
    if (event === 'SELECT' && typeof payload.price === 'number') {
      context.price = payload.price;
    }

    const target = stateTransitions[event];
    if (target === undefined) return;       // 当前状态不处理此事件，忽略

    if (typeof target === 'function') {
      state = target(context);
    } else {
      state = target;
    }
  }

  return {
    get state() { return state; },
    get context() { return { ...context }; },
    dispatch,
  };
}
