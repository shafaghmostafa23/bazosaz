export class BaleApiError extends Error {
  constructor(message, status = 502, code = null) {
    super(message);
    this.name = 'BaleApiError';
    this.status = status;
    this.code = code;
  }
}

export async function callBale(token, method, payload = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://tapi.bale.ai/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let body;
    try { body = await response.json(); }
    catch { throw new BaleApiError('پاسخ بله قابل خواندن نبود.'); }
    if (!response.ok || body?.ok !== true) {
      const description = typeof body?.description === 'string' ? body.description.slice(0, 300) : 'درخواست توسط بله پذیرفته نشد.';
      throw new BaleApiError(description, 502, body?.error_code ?? response.status);
    }
    return body.result;
  } catch (error) {
    if (error instanceof BaleApiError) throw error;
    if (error?.name === 'AbortError') throw new BaleApiError('مهلت پاسخ بله تمام شد.');
    throw new BaleApiError('ارتباط با API بله برقرار نشد.');
  } finally {
    clearTimeout(timeout);
  }
}

export const getMe = (token) => callBale(token, 'getMe');
export const setWebhook = (token, url) => callBale(token, 'setWebhook', { url });
export const deleteWebhook = (token) => callBale(token, 'deleteWebhook');
export const sendMessage = (token, payload) => callBale(token, 'sendMessage', payload);
export const answerCallbackQuery = (token, payload) => callBale(token, 'answerCallbackQuery', payload);
