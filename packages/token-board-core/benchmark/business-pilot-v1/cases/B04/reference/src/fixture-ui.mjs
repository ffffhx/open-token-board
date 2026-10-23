// Evaluation adapter, not historical production code. No Electron or browser profile access.
import { render } from './render-root.mjs';

export let appRoot;
export const store = {};
let backend;
export function configureUi(root, api, state) {
  appRoot = root;
  backend = api;
  for (const key of Object.keys(store)) delete store[key];
  Object.assign(store, { state: null, viewMode: 'main', toast: null, busy: false, modal: null });
  render();
  store.state = state;
  render();
}
export function profileApi() { return backend; }
export async function loadState() { store.state = await backend.getState(); render(); }
export const formatErrorMessage = error => error instanceof Error ? error.message : String(error);
export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function isBusyAction(key, options = {}) {
  return store.busyState?.key === key && (!options.profileId || store.busyState.profileId === options.profileId);
}
export const renderButtonLabel = (busy, normal, pending) => busy ? pending : normal;
export const renderBusyBanner = () => store.busy ? `<p role="status">${escapeHtml(store.busyState?.message || '处理中')}</p>` : '';
export const renderProfilesPanel = profiles => `<ul>${profiles.map(p => `<li data-profile-id="${escapeHtml(p.id)}">${escapeHtml(p.name)} <button data-edit="${escapeHtml(p.id)}">改名</button></li>`).join('')}</ul>`;
export const renderEmpty = () => '<p>暂无 Profile</p>';
const empty = () => '';
export { empty as renderConfirmModal, empty as renderSyncPanel, empty as renderAgentAccessDock,
  empty as renderAgentIntegrationModal, empty as renderOnboardingModal, empty as renderClonePoolModal,
  empty as renderLiveZoomModal, empty as renderMini, empty as renderBifrostProxyModal,
  empty as renderCdpModal, empty as renderCloneTagModal, empty as renderExtensionMigrationModal,
  empty as renderGlobalInstructionsModal, empty as renderNewModal, empty as renderExternalDetailsModal,
  empty as renderProfileDetailsModal };

// Historical functions; the submit Promise is exposed for deterministic awaiting.
const TOAST_NAME_START = String.fromCharCode(1);
const TOAST_NAME_END = String.fromCharCode(2);
export function emphasizeName(name) {
    return `${TOAST_NAME_START}${name}${TOAST_NAME_END}`;
}
export function renderToastBody(message) {
    return escapeHtml(message).split(TOAST_NAME_START).join('<span class="toast-name font-mono font-semibold text-accent-bright">').split(TOAST_NAME_END).join("</span>");
}
export function setToast(message, kind = "normal") {
    store.toast = message;
    store.toastKind = kind;
    render();
    window.clearTimeout(store.toastTimer);
    store.toastTimer = window.setTimeout(()=>{
        store.toast = null;
        render();
    }, 3200);
}
export function doneBusySteps(labels) {
    return labels.map((label)=>({
            label,
            status: "done"
        }));
}
export async function withBusy(work, successMessage, nextBusyState, handleError) {
    if (store.busy) {
        return;
    }
    store.busy = true;
    store.busyState = nextBusyState || {
        key: "generic",
        message: "正在处理…"
    };
    render();
    try {
        await work();
        if (successMessage) {
            if (store.busyState?.steps?.length) {
                store.busyState = {
                    ...store.busyState,
                    message: successMessage,
                    steps: doneBusySteps(store.busyState.steps.map((step)=>step.label))
                };
                render();
            }
            setToast(successMessage);
        }
    } catch (error) {
        const message = formatErrorMessage(error);
        if (handleError?.(message, error)) {
            return;
        }
        const cancelled = message.startsWith("已终止同步") || message.startsWith("已取消");
        setToast(message, cancelled ? "normal" : "error");
    } finally{
        store.busy = false;
        store.busyState = null;
        await loadState().catch((error)=>setToast(formatErrorMessage(error), "error"));
    }
}

export function renderRenameModal(profileId) {
    const profile = store.state?.profiles.find((item)=>item.id === profileId);
    if (!profile) {
        return "";
    }
    const renaming = isBusyAction("rename-profile", {
        profileId
    });
    return `
    <div class="modal-backdrop" data-action="close-modal">
      <form class="modal max-h-[calc(100vh-36px)] overflow-auto overflow-x-hidden border-solid border border-line-strong rounded-xl bg-[linear-gradient(180deg,var(--panel-raise),var(--panel))] p-5 [box-shadow:0_30px_90px_rgba(2,6,9,0.8),0_0_0_1px_rgba(56,225,160,0.06)]" data-rename-form data-profile-id="${escapeHtml(profile.id)}">
        <h2>修改 Profile 名称</h2>
        <div class="field grid gap-2 my-[18px]">
          <label for="profile-rename">名称</label>
          <input id="profile-rename" name="name" type="text" maxlength="80" autocomplete="off" required value="${escapeHtml(profile.name)}" />
          <span class="field-note text-muted text-[12px] leading-[1.45]">只修改本工具里的显示名称，不改变 Profile 目录。</span>
        </div>
        <div class="modal-actions">
          <button type="button" data-action="close-modal">取消</button>
          <button type="submit" class="primary ${renaming ? "loading" : ""}" ${store.busy ? "disabled" : ""}>
            ${renderButtonLabel(renaming, "保存", "保存中…")}
          </button>
        </div>
      </form>
    </div>
  `;
}

export async function submitRename(renameForm) {
    if (renameForm) {
        const profileId = renameForm.dataset.profileId;
        const profile = store.state?.profiles.find((item)=>item.id === profileId);
        if (!profileId || !profile) {
            return;
        }
        const data = new FormData(renameForm);
        const name = String(data.get("name") || "").trim();
        return withBusy(async ()=>{
            const nextState = await profileApi().renameProfile(profileId, name);
            store.state = nextState;
            store.selectedId = profileId;
            store.modal = null;
        }, `已改名为 ${name}`, {
            key: "rename-profile",
            message: "正在保存名称…",
            profileId
        });
        return;
    }
}
