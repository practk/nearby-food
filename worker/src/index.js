import { DurableObject } from 'cloudflare:workers';
import { handleRequest, nextUsage } from './handler.js';

const STATE_KEY = 'usage';

function toUsage(state, dailyLimit) {
  return { today: state.today, dailyLimit, month: state.monthTotal };
}

// Durable Object 一次只處理一筆請求，同時多人查詢時計數也不會算錯，才能當硬性上限。
export class UsageCounter extends DurableObject {
  async consume(date, limit) {
    const current = await this.ctx.storage.get(STATE_KEY);
    const { allowed, state } = nextUsage(current, date, limit);
    await this.ctx.storage.put(STATE_KEY, state);
    return { allowed, usage: toUsage(state, limit) };
  }

  async read(date, limit) {
    const current = await this.ctx.storage.get(STATE_KEY);
    // 額度傳 0 代表只讀取：套用換日、換月規則，但不加一也不寫入。
    const { state } = nextUsage(current, date, 0);
    return toUsage(state, limit);
  }
}

export default {
  fetch(request, env) {
    // 全部查詢共用同一個計數器，才能算出所有裝置的合計用量。
    const counter = env.USAGE.get(env.USAGE.idFromName('global'));
    return handleRequest(request, env, { counter });
  },
};
