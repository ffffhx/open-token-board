// Minimal DOM adapter for the extracted renderer's form lifecycle. It is not a browser E2E test.
const unescape = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]);
export function createDom() {
  const toasts = new Map();
  const root = {
    html: '', form: null, writes: 0,
    get innerHTML() { return this.html; },
    set innerHTML(value) {
      this.html = value; this.writes++;
      const match = value.match(/<form\b[^>]*data-rename-form[^>]*data-profile-id="([^"]*)"[^>]*>([\s\S]*?)<\/form>/);
      const field = match?.[2].match(/<input\b[^>]*id="profile-rename"[^>]*value="([^"]*)"/);
      this.form = match && field ? {
        dataset: { profileId: unescape(match[1]) },
        input: { value: unescape(field[1]) },
        querySelector(selector) { return selector === '#profile-rename' ? this.input : null; }
      } : null;
    },
    querySelector(selector) {
      return selector === '[data-rename-form]' ? this.form : selector === '#profile-rename' ? this.form?.input || null : null;
    }
  };
  const document = {
    body: { classList: { remove() {} }, appendChild(element) { toasts.set(element.id, element); } },
    getElementById(id) { return toasts.get(id) || null; },
    createElement() { return { innerHTML: '', setAttribute() {}, remove() { toasts.delete(this.id); } }; }
  };
  class FormData {
    constructor(form) { this.name = form.input.value; }
    get(key) { return key === 'name' ? this.name : null; }
  }
  const window = { clearTimeout() {}, setTimeout() { return 1; } };
  return { root, document, window, FormData };
}
