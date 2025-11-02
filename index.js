import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, event_types, eventSource } from "../../../../script.js";
import { executeSlashCommandsOnChatInput, registerSlashCommand } from "../../../slash-commands.js";
import {
    DEFAULT_PROFILE_NAME,
    defaultSettings,
    ensureProfileShape,
    ensureSettingsShape,
    findCostumeForTrigger,
    findCostumeForText,
    composeCostumePath,
    normalizeCostumeFolder,
    normalizeTriggerEntry,
    normalizeVariantEntry,
    buildStreamBuffer,
} from "./src/simple-switcher.js";
import { getOutfitSlashCommandConfig } from "./src/verbs.js";

const extensionName = "SillyTavern-OutfitSwitch-Testing";
const logPrefix = "[OutfitSwitch]";

let settings = ensureSettingsShape(extension_settings[extensionName] || defaultSettings);
let statusTimer = null;
let settingsPanelPromise = null;
const automationState = {
    handlers: [],
    registered: false,
    lastMessageSignature: null,
    lastAppliedCostume: null,
    streamKey: null,
    streamBuffer: "",
    streamIssuedCostume: null,
    streamTrigger: null,
};

const STREAM_BUFFER_LIMIT = 2000;

const AUTO_SAVE_DEBOUNCE_MS = 800;
const AUTO_SAVE_NOTICE_COOLDOWN_MS = 1800;
const AUTO_SAVE_REASON_OVERRIDES = {
    enabled: "the master toggle",
    baseFolder: "the base folder",
    variants: "your variants",
    triggers: "your triggers",
    profiles: "your profiles",
    activeProfile: "the active profile",
};

const autoSaveState = {
    timer: null,
    pendingReasons: new Set(),
    lastNoticeAt: new Map(),
};

extension_settings[extensionName] = settings;

const uiState = {
    profileSelect: null,
    profilePill: null,
    profileCreateButton: null,
    profileDuplicateButton: null,
    profileRenameButton: null,
    profileDeleteButton: null,
    profileExportButton: null,
    profileImportButton: null,
    profileImportInput: null,
    baseFolderInput: null,
};

function getProfiles() {
    if (!settings.profiles || typeof settings.profiles !== "object" || Array.isArray(settings.profiles)) {
        settings.profiles = { [DEFAULT_PROFILE_NAME]: ensureProfileShape() };
    }
    return settings.profiles;
}

function getActiveProfileName() {
    const profiles = getProfiles();
    let activeName = typeof settings.activeProfile === "string" ? settings.activeProfile.trim() : "";
    if (!activeName || !profiles[activeName]) {
        activeName = Object.keys(profiles)[0] || DEFAULT_PROFILE_NAME;
    }

    if (!profiles[activeName]) {
        profiles[activeName] = ensureProfileShape();
    }

    settings.activeProfile = activeName;
    return activeName;
}

function getActiveProfile() {
    const profiles = getProfiles();
    const activeName = getActiveProfileName();
    return profiles[activeName];
}

function normalizeProfileNameInput(value) {
    if (value == null) {
        return "";
    }
    return String(value).replace(/\s+/g, " ").trim();
}

function ensureUniqueProfileName(baseName) {
    const profiles = getProfiles();
    const sanitized = normalizeProfileNameInput(baseName) || DEFAULT_PROFILE_NAME;
    if (!profiles[sanitized]) {
        return sanitized;
    }

    let counter = 2;
    let candidate = `${sanitized} ${counter}`;
    while (profiles[candidate]) {
        counter += 1;
        candidate = `${sanitized} ${counter}`;
    }
    return candidate;
}

function updateProfilePill() {
    if (!uiState.profilePill) {
        return;
    }

    const activeName = getActiveProfileName();
    const profile = getActiveProfile();
    const folder = profile?.baseFolder ? normalizeCostumeFolder(profile.baseFolder) : "";

    const parts = [`<strong>${escapeHtml(activeName)}</strong>`];
    if (folder) {
        parts.push(`<span class="cs-profile-pill-folder">${escapeHtml(folder)}</span>`);
    }

    uiState.profilePill.innerHTML = `Active: ${parts.join(" · ")}`;
}

function syncProfileActionStates() {
    const profiles = getProfiles();
    const profileCount = Object.keys(profiles).length;

    if (uiState.profileDeleteButton) {
        uiState.profileDeleteButton.disabled = profileCount <= 1;
    }
    if (uiState.profileDuplicateButton) {
        uiState.profileDuplicateButton.disabled = profileCount === 0;
    }
    if (uiState.profileRenameButton) {
        uiState.profileRenameButton.disabled = profileCount === 0;
    }
    if (uiState.profileExportButton) {
        uiState.profileExportButton.disabled = profileCount === 0;
    }
}

function populateProfileSelect() {
    if (!uiState.profileSelect) {
        return;
    }

    const profiles = getProfiles();
    const activeName = getActiveProfileName();
    const entries = Object.keys(profiles);

    uiState.profileSelect.innerHTML = "";
    entries.forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        if (name === activeName) {
            option.selected = true;
        }
        uiState.profileSelect.appendChild(option);
    });

    uiState.profileSelect.value = activeName;
    syncProfileActionStates();
}

function syncBaseFolderInput() {
    if (!uiState.baseFolderInput) {
        return;
    }

    const profile = getActiveProfile();
    const desiredValue = profile?.baseFolder || "";
    if (uiState.baseFolderInput.value !== desiredValue) {
        uiState.baseFolderInput.value = desiredValue;
    }
}

function refreshProfileUI() {
    populateProfileSelect();
    updateProfilePill();
    syncBaseFolderInput();
    renderVariants();
    renderTriggers();
}

function setActiveProfile(profileName, { announce = true } = {}) {
    const profiles = getProfiles();
    const normalized = normalizeProfileNameInput(profileName);
    if (!normalized || !profiles[normalized]) {
        showStatus(`Profile "${escapeHtml(profileName || "")}" was not found.`, "error");
        populateProfileSelect();
        return false;
    }

    if (settings.activeProfile === normalized) {
        refreshProfileUI();
        return false;
    }

    flushAutoSave({ showStatusMessage: false });
    settings.activeProfile = normalized;
    persistSettings("activeProfile");
    refreshProfileUI();

    if (announce) {
        showStatus(`Switched to <b>${escapeHtml(normalized)}</b>.`, "success", 2000);
    }

    return true;
}

function createProfileFromTemplate({ name, template, announce = true, reason = "profiles" } = {}) {
    const profiles = getProfiles();
    const uniqueName = ensureUniqueProfileName(name);
    const sourceProfile = template && typeof template === "object" ? template : ensureProfileShape();

    flushAutoSave({ showStatusMessage: false });
    profiles[uniqueName] = ensureProfileShape(sourceProfile);
    settings.activeProfile = uniqueName;
    persistSettings(reason);
    refreshProfileUI();

    if (announce) {
        showStatus(`Created profile <b>${escapeHtml(uniqueName)}</b>.`, "success", 2200);
    }

    return uniqueName;
}

function handleProfileSelectChange(event) {
    const selected = event?.target?.value;
    if (!selected) {
        return;
    }
    setActiveProfile(selected, { announce: true });
}

function handleCreateProfile() {
    const defaultName = ensureUniqueProfileName("New Profile");
    const raw = prompt("Name your new outfit profile:", defaultName);
    if (raw === null) {
        return;
    }

    const desired = normalizeProfileNameInput(raw);
    if (!desired) {
        showStatus("Enter a profile name to continue.", "error");
        return;
    }

    const uniqueName = ensureUniqueProfileName(desired);
    const createdName = createProfileFromTemplate({ name: uniqueName, announce: false });
    if (createdName !== desired) {
        showStatus(`Saved as <b>${escapeHtml(createdName)}</b> because that name was available.`, "info", 2600);
    } else {
        showStatus(`Created profile <b>${escapeHtml(createdName)}</b>.`, "success", 2200);
    }
}

function handleDuplicateProfile() {
    const activeProfile = getActiveProfile();
    if (!activeProfile) {
        showStatus("Create a profile before duplicating it.", "error");
        return;
    }

    const baseName = `${getActiveProfileName()} Copy`;
    const raw = prompt("Duplicate profile as:", ensureUniqueProfileName(baseName));
    if (raw === null) {
        return;
    }

    const desired = normalizeProfileNameInput(raw);
    if (!desired) {
        showStatus("Enter a profile name to duplicate.", "error");
        return;
    }

    const uniqueName = ensureUniqueProfileName(desired);
    const createdName = createProfileFromTemplate({ name: uniqueName, template: activeProfile, announce: false });
    if (createdName !== desired) {
        showStatus(`Saved duplicate as <b>${escapeHtml(createdName)}</b>.`, "info", 2400);
    } else {
        showStatus(`Duplicated profile to <b>${escapeHtml(createdName)}</b>.`, "success", 2200);
    }
}

function handleRenameProfile() {
    const activeName = getActiveProfileName();
    const raw = prompt(`Rename "${activeName}" to:`, activeName);
    if (raw === null) {
        return;
    }

    const desired = normalizeProfileNameInput(raw);
    if (!desired) {
        showStatus("Enter a profile name to continue.", "error");
        populateProfileSelect();
        return;
    }

    if (desired === activeName) {
        showStatus("Profile name unchanged.", "info");
        return;
    }

    const profiles = getProfiles();
    if (profiles[desired]) {
        showStatus("A profile with that name already exists.", "error");
        return;
    }

    flushAutoSave({ showStatusMessage: false });
    profiles[desired] = profiles[activeName];
    delete profiles[activeName];
    settings.activeProfile = desired;
    persistSettings("profiles");
    refreshProfileUI();
    showStatus(`Renamed profile to <b>${escapeHtml(desired)}</b>.`, "success", 2200);
}

function handleDeleteProfile() {
    const profiles = getProfiles();
    const activeName = getActiveProfileName();
    if (Object.keys(profiles).length <= 1) {
        showStatus("Keep at least one profile available.", "error");
        return;
    }

    const confirmed = confirm(`Delete the "${activeName}" profile? This cannot be undone.`);
    if (!confirmed) {
        populateProfileSelect();
        return;
    }

    flushAutoSave({ showStatusMessage: false });
    delete profiles[activeName];
    settings.activeProfile = Object.keys(profiles)[0] || DEFAULT_PROFILE_NAME;
    persistSettings("profiles");
    refreshProfileUI();
    showStatus(`Deleted <b>${escapeHtml(activeName)}</b>. Switched to <b>${escapeHtml(getActiveProfileName())}</b>.`, "success", 2600);
}

function handleExportProfile() {
    const activeName = getActiveProfileName();
    const profile = getActiveProfile();
    if (!profile) {
        showStatus("No profile available to export.", "error");
        return;
    }

    flushAutoSave({ showStatusMessage: false });

    const payload = {
        name: activeName,
        profile,
        version: settings.version,
    };

    const json = JSON.stringify(payload, null, 2);
    const dataUrl = `data:text/json;charset=utf-8,${encodeURIComponent(json)}`;
    const link = document.createElement("a");
    link.href = dataUrl;
    const safeName = activeName.replace(/[^a-z0-9-_]+/gi, "_");
    link.download = `${safeName || "outfit_profile"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    showStatus(`Exported <b>${escapeHtml(activeName)}</b> to a .json file.`, "success", 2200);
}

async function handleProfileImport(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) {
        return;
    }

    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const profileData = parsed?.profile || parsed?.data || parsed;
        if (!profileData || typeof profileData !== "object") {
            throw new Error("Invalid profile file");
        }

        const nameCandidate = parsed?.name || parsed?.profileName || file.name.replace(/\.[^.]+$/, "");
        const uniqueName = ensureUniqueProfileName(nameCandidate || "Imported Profile");
        const createdName = createProfileFromTemplate({ name: uniqueName, template: profileData, announce: false });
        showStatus(`Imported profile <b>${escapeHtml(createdName)}</b>.`, "success", 2400);
    } catch (error) {
        console.error(`${logPrefix} Failed to import profile`, error);
        showStatus("Unable to import that profile file.", "error", 3200);
    } finally {
        if (uiState.profileImportInput) {
            uiState.profileImportInput.value = "";
        }
    }
}

function persistSettings(reason = "update") {
    settings = ensureSettingsShape(settings);
    extension_settings[extensionName] = settings;
    try {
        saveSettingsDebounced?.(reason);
    } catch (err) {
        console.error(`${logPrefix} Failed to save settings`, err);
    }
}

function clearAutoSaveTimer() {
    if (autoSaveState.timer) {
        clearTimeout(autoSaveState.timer);
        autoSaveState.timer = null;
    }
}

function formatAutoSaveReason(key) {
    if (!key) {
        return "changes";
    }

    if (Object.prototype.hasOwnProperty.call(AUTO_SAVE_REASON_OVERRIDES, key)) {
        return AUTO_SAVE_REASON_OVERRIDES[key];
    }

    return key
        .replace(/([A-Z])/g, " $1")
        .trim()
        .toLowerCase();
}

function summarizeAutoSaveReasons(reasonSet) {
    const list = Array.from(reasonSet || []).filter(Boolean);
    if (!list.length) {
        return "changes";
    }

    if (list.length === 1) {
        return list[0];
    }

    const head = list.slice(0, -1).join(", ");
    const tail = list[list.length - 1];
    return head ? `${head} and ${tail}` : tail;
}

function announceAutoSaveIntent(element, reason, message, key) {
    const noticeKey = key
        || element?.dataset?.changeNoticeKey
        || element?.id
        || element?.name
        || (reason ? reason.replace(/\s+/g, "-") : "auto-save");

    const now = Date.now();
    const last = autoSaveState.lastNoticeAt.get(noticeKey);
    if (last && now - last < AUTO_SAVE_NOTICE_COOLDOWN_MS) {
        return;
    }

    autoSaveState.lastNoticeAt.set(noticeKey, now);
    const noticeMessage = message
        || element?.dataset?.changeNotice
        || (reason ? `Auto-saving ${reason}…` : "Auto-saving changes…");
    showStatus(noticeMessage, "info", 2000);
}

function scheduleAutoSave({ key, reason, element, noticeMessage, noticeKey, debounceMs = AUTO_SAVE_DEBOUNCE_MS, announce = true } = {}) {
    const reasonText = reason || formatAutoSaveReason(key);
    if (reasonText) {
        autoSaveState.pendingReasons.add(reasonText);
    }

    if (announce) {
        announceAutoSaveIntent(element, reasonText, noticeMessage, noticeKey || key);
    }

    clearAutoSaveTimer();
    const delay = Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : AUTO_SAVE_DEBOUNCE_MS;
    autoSaveState.timer = setTimeout(() => {
        flushAutoSave({});
    }, delay);
}

function flushAutoSave({ force = false, overrideMessage, showStatusMessage = true } = {}) {
    const hasPending = autoSaveState.pendingReasons.size > 0;
    if (!hasPending && !force) {
        return false;
    }

    const summary = summarizeAutoSaveReasons(autoSaveState.pendingReasons);
    clearAutoSaveTimer();
    persistSettings("auto-save");
    autoSaveState.pendingReasons.clear();

    const message = overrideMessage !== undefined
        ? overrideMessage
        : (hasPending ? `Auto-saved ${summary}.` : null);

    if (message && showStatusMessage) {
        showStatus(message, "success", 2000);
    }

    return true;
}

function resetStreamTracking() {
    automationState.streamKey = null;
    automationState.streamBuffer = "";
    automationState.streamIssuedCostume = null;
    automationState.streamTrigger = null;
}

function resetAutomationTracking() {
    automationState.lastMessageSignature = null;
    automationState.lastAppliedCostume = null;
    resetStreamTracking();
}

function buildMessageSignature(details) {
    if (!details) {
        return null;
    }

    if (details.key) {
        return details.key;
    }

    if (Number.isFinite(details.id)) {
        return `id:${details.id}`;
    }

    if (typeof details.text === "string" && details.text.trim()) {
        return details.text.trim();
    }

    return null;
}

function resolveMessageCandidate(value, visited) {
    if (value == null) {
        return null;
    }

    if (typeof value === "string") {
        return value.trim() ? { text: value, isUser: false, key: null, id: null } : null;
    }

    if (typeof value !== "object") {
        return null;
    }

    if (visited.has(value)) {
        return null;
    }
    visited.add(value);

    if (Array.isArray(value)) {
        for (const entry of value) {
            const result = resolveMessageCandidate(entry, visited);
            if (result && result.text) {
                return result;
            }
        }
        return null;
    }

    const textCandidate = typeof value.mes === "string"
        ? value.mes
        : (typeof value.text === "string"
              ? value.text
              : (typeof value.message === "string" ? value.message : null));

    const isUser = Boolean(value.is_user ?? value.isUser ?? (typeof value.role === "string" && value.role.toLowerCase() === "user"));
    const key = typeof value.key === "string"
        ? value.key
        : (typeof value.bufKey === "string"
              ? value.bufKey
              : (typeof value.messageKey === "string" ? value.messageKey : null));
    const idCandidate = [value.id, value.mesId, value.messageId].find((candidate) => Number.isFinite(candidate));
    const id = idCandidate != null ? Number(idCandidate) : null;

    if (typeof textCandidate === "string" && textCandidate.trim()) {
        return { text: textCandidate, isUser, key, id };
    }

    const nestedSources = [
        value.message,
        value.data,
        value.payload,
        value.detail,
        value.result,
        value.output,
        value.content,
        value.response,
        value.entry,
    ];

    for (const nested of nestedSources) {
        if (nested && typeof nested !== "function") {
            const result = resolveMessageCandidate(nested, visited);
            if (result && result.text) {
                return {
                    text: result.text,
                    isUser: result.isUser ?? isUser,
                    key: result.key || key,
                    id: result.id ?? id,
                };
            }
        }
    }

    for (const nested of Object.values(value)) {
        if (nested && typeof nested !== "function") {
            const result = resolveMessageCandidate(nested, visited);
            if (result && result.text) {
                return result;
            }
        }
    }

    return null;
}

function extractMessageDetails(args) {
    const visited = new Set();
    for (const arg of args) {
        const result = resolveMessageCandidate(arg, visited);
        if (result && typeof result.text === "string" && result.text.trim()) {
            return result;
        }
    }
    return { text: "", isUser: false, key: null, id: null };
}

function resolveStreamReference(args) {
    for (const arg of args) {
        if (arg == null) {
            continue;
        }

        if (typeof arg === "number" && Number.isFinite(arg)) {
            return `m${arg}`;
        }

        if (typeof arg === "string" && arg.trim()) {
            return arg.trim();
        }

        if (typeof arg === "object") {
            const stringCandidates = [
                arg.bufKey,
                arg.key,
                arg.messageKey,
                arg.generationType,
                arg.streamKey,
            ];
            for (const value of stringCandidates) {
                if (typeof value === "string" && value.trim()) {
                    return value.trim();
                }
            }

            const numberCandidates = [arg.messageId, arg.mesId, arg.id];
            for (const value of numberCandidates) {
                if (Number.isFinite(value)) {
                    return `m${value}`;
                }
            }

            if (typeof arg.message === "object" && arg.message !== null) {
                const nested = resolveStreamReference([arg.message]);
                if (nested) {
                    return nested;
                }
            }
        }
    }

    return null;
}

function resolveStreamTokenText(args) {
    if (!Array.isArray(args) || !args.length) {
        return "";
    }

    const first = args[0];
    if (typeof first === "number") {
        return String(args[1] ?? "");
    }

    if (typeof first === "object" && first !== null) {
        const token = first.token ?? first.text ?? first.value;
        if (token != null) {
            return String(token);
        }
    }

    for (const arg of args) {
        if (typeof arg === "string" && arg) {
            return arg;
        }
    }

    return "";
}

function automationMessageHandler(...args) {
    if (!settings.enabled) {
        return;
    }

    const details = extractMessageDetails(args);
    if (!details || !details.text || details.isUser) {
        return;
    }

    const profile = getActiveProfile();
    const match = findCostumeForText(profile, details.text);
    if (!match || !match.costume) {
        return;
    }

    const signature = buildMessageSignature(details);

    if (automationState.streamIssuedCostume && automationState.streamIssuedCostume === match.costume) {
        automationState.lastMessageSignature = signature;
        automationState.lastAppliedCostume = match.costume;
        resetStreamTracking();
        return;
    }
    if (
        signature
        && automationState.lastMessageSignature === signature
        && automationState.lastAppliedCostume === match.costume
    ) {
        return;
    }

    automationState.lastMessageSignature = signature;
    automationState.lastAppliedCostume = match.costume;

    console.log(`${logPrefix} Auto-switching to "${match.costume}" (triggered by ${match.trigger}).`);
    issueCostume(match.costume, { source: "automation" });
}

function automationGenerationStartedHandler(...args) {
    if (!settings.enabled) {
        return;
    }

    resetStreamTracking();
    const reference = resolveStreamReference(args);
    if (reference) {
        automationState.streamKey = reference;
    } else {
        automationState.streamKey = `stream-${Date.now()}`;
    }
}

function automationStreamHandler(...args) {
    if (!settings.enabled) {
        return;
    }

    const profile = getActiveProfile();
    if (!profile) {
        return;
    }

    const tokenText = resolveStreamTokenText(args);
    if (!tokenText) {
        return;
    }

    const reference = resolveStreamReference(args);
    if (reference && automationState.streamKey && automationState.streamKey !== reference) {
        resetStreamTracking();
        automationState.streamKey = reference;
    } else if (!automationState.streamKey) {
        automationState.streamKey = reference || `stream-${Date.now()}`;
    }

    automationState.streamBuffer = buildStreamBuffer(automationState.streamBuffer, tokenText, { limit: STREAM_BUFFER_LIMIT });

    const match = findCostumeForText(profile, automationState.streamBuffer);
    if (!match || !match.costume) {
        return;
    }

    if (automationState.streamIssuedCostume === match.costume) {
        return;
    }

    automationState.streamIssuedCostume = match.costume;
    automationState.streamTrigger = match.trigger;
    automationState.lastAppliedCostume = match.costume;

    console.log(`${logPrefix} Streaming auto-switching to "${match.costume}" (triggered by ${match.trigger}).`);
    issueCostume(match.costume, { source: "automation" });
}

function registerAutomationHandlers() {
    if (automationState.registered || !eventSource?.on) {
        return;
    }

    automationState.handlers = [];

    const events = [event_types?.CHARACTER_MESSAGE_RENDERED, event_types?.MESSAGE_RENDERED]
        .filter((eventName) => typeof eventName === "string");
    const streamEvents = [event_types?.STREAM_TOKEN_RECEIVED]
        .filter((eventName) => typeof eventName === "string");
    const generationEvents = [event_types?.GENERATION_STARTED]
        .filter((eventName) => typeof eventName === "string");
    const resetEvents = [
        event_types?.CHAT_CHANGED,
        event_types?.STREAM_ENDED,
        event_types?.STREAM_FINISHED,
        event_types?.STREAM_COMPLETE,
        event_types?.GENERATION_ENDED,
    ].filter((eventName) => typeof eventName === "string");

    events.forEach((eventName) => {
        eventSource.on(eventName, automationMessageHandler);
        automationState.handlers.push({ eventName, handler: automationMessageHandler });
    });

    streamEvents.forEach((eventName) => {
        eventSource.on(eventName, automationStreamHandler);
        automationState.handlers.push({ eventName, handler: automationStreamHandler });
    });

    generationEvents.forEach((eventName) => {
        eventSource.on(eventName, automationGenerationStartedHandler);
        automationState.handlers.push({ eventName, handler: automationGenerationStartedHandler });
    });

    resetEvents.forEach((eventName) => {
        eventSource.on(eventName, resetAutomationTracking);
        automationState.handlers.push({ eventName, handler: resetAutomationTracking });
    });

    automationState.registered = automationState.handlers.length > 0;
}

function teardownAutomationHandlers() {
    if (!automationState.handlers.length || !eventSource?.off) {
        automationState.handlers = [];
        automationState.registered = false;
        resetAutomationTracking();
        return;
    }

    automationState.handlers.forEach(({ eventName, handler }) => {
        try {
            eventSource.off(eventName, handler);
        } catch (error) {
            console.warn(`${logPrefix} Failed to detach automation handler for ${eventName}`, error);
        }
    });

    automationState.handlers = [];
    automationState.registered = false;
    resetAutomationTracking();
}

function getElement(selector) {
    return document.querySelector(selector);
}

function waitForElement(selector, { timeout = 10000 } = {}) {
    const existing = document.querySelector(selector);
    if (existing) {
        return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
        const root = document.documentElement || document.body;
        if (!root) {
            reject(new Error("Document is not ready."));
            return;
        }

        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element) {
                observer.disconnect();
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                resolve(element);
            }
        });

        const timeoutId = Number.isFinite(timeout) && timeout > 0
            ? setTimeout(() => {
                  observer.disconnect();
                  reject(new Error(`Timed out waiting for selector: ${selector}`));
              }, timeout)
            : null;

        observer.observe(root, { childList: true, subtree: true });
    });
}

async function ensureSettingsPanel() {
    if (document.getElementById("outfit-switcher-settings")) {
        return document.getElementById("outfit-switcher-settings");
    }

    if (!settingsPanelPromise) {
        settingsPanelPromise = (async () => {
            const container = await waitForElement("#extensions_settings");

            const settingsUrl = new URL("./settings.html", import.meta.url);
            const response = await fetch(settingsUrl);
            if (!response.ok) {
                throw new Error(`Failed to load settings markup (${response.status})`);
            }

            const markup = await response.text();
            const template = document.createElement("template");
            template.innerHTML = markup.trim();
            const panel = template.content.firstElementChild;

            if (!panel) {
                throw new Error("Settings markup did not contain a root element.");
            }

            container.appendChild(panel);
            return panel;
        })().catch((error) => {
            console.error(`${logPrefix} Failed to inject settings panel`, error);
            settingsPanelPromise = null;
            throw error;
        });
    }

    return settingsPanelPromise;
}

function showStatus(message, type = "info", duration = 2500) {
    const statusEl = getElement("#os-status");
    const textEl = getElement("#os-status-text");
    if (!statusEl || !textEl) {
        console.log(`${logPrefix} ${message}`);
        return;
    }

    statusEl.dataset.type = type;
    textEl.innerHTML = message;

    statusEl.classList.add("is-visible");
    if (statusTimer) {
        clearTimeout(statusTimer);
    }
    statusTimer = setTimeout(() => {
        statusEl.classList.remove("is-visible");
        textEl.textContent = "Ready";
        statusTimer = null;
    }, Math.max(duration, 1000));
}

async function populateBuildMeta() {
    let versionEl;
    let noteEl;
    try {
        [versionEl, noteEl] = await Promise.all([
            waitForElement("#os-build-version"),
            waitForElement("#os-build-note"),
        ]);
    } catch (error) {
        console.warn(`${logPrefix} Unable to resolve build metadata elements`, error);
        return;
    }

    const fallbackNote = "";

    try {
        const manifestUrl = new URL("./manifest.json", import.meta.url);
        const response = await fetch(manifestUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch manifest (${response.status})`);
        }

        const manifest = await response.json();
        const rawVersion = typeof manifest?.version === "string" ? manifest.version.trim() : "";
        const versionLabel = rawVersion ? `v${rawVersion}` : (manifest?.title || manifest?.display_name || "Outfit Switcher");
        versionEl.textContent = versionLabel;

        if (rawVersion) {
            versionEl.dataset.version = rawVersion;
            versionEl.setAttribute("title", `Outfit Switcher ${versionLabel}`);
            versionEl.setAttribute("aria-label", `Outfit Switcher ${versionLabel}`);
        } else {
            delete versionEl.dataset.version;
            versionEl.removeAttribute("title");
            versionEl.removeAttribute("aria-label");
        }

        noteEl.textContent = fallbackNote;
    } catch (error) {
        console.warn(`${logPrefix} Unable to populate build metadata`, error);
        versionEl.textContent = "Outfit Switcher";
        delete versionEl.dataset.version;
        versionEl.removeAttribute("title");
        versionEl.removeAttribute("aria-label");
        noteEl.textContent = fallbackNote;
    }
}

async function issueCostume(folder, { source = "ui" } = {}) {
    const normalized = normalizeCostumeFolder(folder);
    if (!normalized) {
        const message = "Provide an outfit folder for the focus character.";
        if (source === "slash") {
            return message;
        }
        showStatus(message, "error");
        return message;
    }

    try {
        await executeSlashCommandsOnChatInput(`/costume \\${normalized}`);
        const successMessage = `Updated the focus character's outfit to <b>${escapeHtml(normalized)}</b>.`;
        if (source === "slash") {
            return successMessage;
        }
        showStatus(successMessage, "success");
        return successMessage;
    } catch (err) {
        console.error(`${logPrefix} Failed to execute /costume for "${normalized}"`, err);
        const failureMessage = `Failed to update the focus character's outfit to <b>${escapeHtml(normalized)}</b>.`;
        if (source === "slash") {
            return failureMessage;
        }
        showStatus(failureMessage, "error", 4000);
        return failureMessage;
    }
}

function escapeHtml(str) {
    const p = document.createElement("p");
    p.textContent = str;
    return p.innerHTML;
}

function extractDirectoryFromFileList(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
        return "";
    }

    const file = files[0];
    if (file && typeof file.webkitRelativePath === "string" && file.webkitRelativePath) {
        const segments = file.webkitRelativePath.split("/");
        if (segments.length > 1) {
            segments.pop();
            return segments.join("/");
        }
        return file.webkitRelativePath;
    }

    if (file && typeof file.name === "string") {
        return file.name;
    }

    return "";
}

function deriveRelativeFolder(folderPath) {
    const normalized = normalizeCostumeFolder(folderPath);
    if (!normalized) {
        return "";
    }

    const base = normalizeCostumeFolder(getActiveProfile().baseFolder);
    if (!base) {
        return normalized;
    }

    const normalizedLower = normalized.toLowerCase();
    const baseLower = base.toLowerCase();

    if (normalizedLower === baseLower) {
        return "";
    }

    if (normalizedLower.startsWith(`${baseLower}/`)) {
        return normalized.slice(base.length + 1);
    }

    if (normalizedLower.startsWith(baseLower)) {
        return normalized.slice(base.length).replace(/^\/+/, "");
    }

    return normalized;
}

function attachFolderPicker(button, targetInput, { mode = "absolute" } = {}) {
    if (!button || !targetInput) {
        return;
    }

    if (button.dataset.hasFolderPicker === "true") {
        return;
    }

    const picker = document.createElement("input");
    picker.type = "file";
    picker.hidden = true;
    picker.multiple = true;
    picker.setAttribute("webkitdirectory", "true");
    picker.setAttribute("directory", "true");

    button.insertAdjacentElement("afterend", picker);
    button.dataset.hasFolderPicker = "true";

    button.addEventListener("click", () => {
        picker.click();
    });

    picker.addEventListener("change", () => {
        const folderPath = extractDirectoryFromFileList(picker.files);
        if (!folderPath) {
            picker.value = "";
            return;
        }

        const value = mode === "relative" ? deriveRelativeFolder(folderPath) : normalizeCostumeFolder(folderPath);
        targetInput.value = value;
        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
        picker.value = "";
    });
}

function handleEnableToggle(event) {
    settings.enabled = Boolean(event.target.checked);
    scheduleAutoSave({ key: "enabled", element: event.target, announce: false });
    if (!settings.enabled) {
        resetAutomationTracking();
    }
    showStatus(settings.enabled ? "Outfit switching enabled." : "Outfit switching disabled.", "info");
}

function addTriggerRow(trigger = { trigger: "", folder: "" }) {
    const profile = getActiveProfile();
    profile.triggers.push(normalizeTriggerEntry(trigger));
    scheduleAutoSave({ key: "triggers", noticeKey: "triggers" });
    renderTriggers();
}

function removeTriggerRow(index) {
    const profile = getActiveProfile();
    profile.triggers.splice(index, 1);
    scheduleAutoSave({ key: "triggers", noticeKey: "triggers" });
    renderTriggers();
}

function parseTriggerTextareaValue(value) {
    if (typeof value !== "string" || !value.trim()) {
        return [];
    }

    const results = [];
    value
        .split(/\r?\n|,/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
            if (!results.includes(part)) {
                results.push(part);
            }
        });

    return results;
}

function bindTriggerInputs(row, index) {
    const triggerInput = row.querySelector(".cs-trigger-input");
    const folderInput = row.querySelector(".cs-folder-input");
    const runButton = row.querySelector(".cs-trigger-run");
    const deleteButton = row.querySelector(".cs-trigger-delete");
    const folderButton = row.querySelector(".cs-trigger-folder-select");

    const profile = getActiveProfile();
    const triggerList = Array.isArray(profile.triggers[index].triggers) && profile.triggers[index].triggers.length
        ? profile.triggers[index].triggers
        : (profile.triggers[index].trigger ? [profile.triggers[index].trigger] : []);
    triggerInput.value = triggerList.join("\n");
    folderInput.value = profile.triggers[index].folder;

    triggerInput.addEventListener("input", (event) => {
        const activeProfile = getActiveProfile();
        const triggers = parseTriggerTextareaValue(event.target.value);
        activeProfile.triggers[index].triggers = triggers;
        activeProfile.triggers[index].trigger = triggers[0] || "";
        scheduleAutoSave({ key: "triggers", element: event.target });
    });

    folderInput.addEventListener("input", (event) => {
        const activeProfile = getActiveProfile();
        activeProfile.triggers[index].folder = event.target.value;
        scheduleAutoSave({ key: "triggers", element: event.target });
    });

    runButton.addEventListener("click", async () => {
        flushAutoSave({ showStatusMessage: false });
        if (!settings.enabled) {
            showStatus("Enable Outfit Switcher to use triggers.", "error");
            return;
        }
        const activeProfile = getActiveProfile();
        const targetFolder = composeCostumePath(activeProfile.baseFolder, activeProfile.triggers[index].folder);
        const result = await issueCostume(targetFolder, { source: "ui" });
        if (result.toLowerCase().startsWith("please provide")) {
            showStatus("Enter an outfit folder before running the trigger.", "error");
        }
    });

    deleteButton.addEventListener("click", () => {
        removeTriggerRow(index);
    });

    attachFolderPicker(folderButton, folderInput, { mode: "relative" });
}

function renderTriggers() {
    const tbody = getElement("#os-trigger-table-body");
    if (!tbody) {
        return;
    }

    tbody.innerHTML = "";
    const profile = getActiveProfile();

    profile.triggers.forEach((trigger, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="cs-trigger-column cs-trigger-column-triggers">
                <textarea class="text_pole cs-trigger-input" rows="2" placeholder="winter\nformal\n/regex/"></textarea>
                <small class="cs-trigger-helper">Matches case-insensitive keywords, comma lists, or /regex/ entries—just like Costume Switcher.</small>
            </td>
            <td class="cs-trigger-column cs-trigger-column-folder">
                <div class="cs-folder-picker">
                    <input type="text" class="text_pole cs-folder-input" placeholder="Variant folder" />
                    <button type="button" class="menu_button interactable cs-button-ghost cs-folder-button cs-trigger-folder-select">
                        <i class="fa-solid fa-folder-open"></i>
                        <span>Pick Folder</span>
                    </button>
                </div>
            </td>
            <td class="cs-trigger-actions">
                <button type="button" class="menu_button interactable cs-trigger-run">Run</button>
                <button type="button" class="menu_button interactable cs-trigger-delete">Remove</button>
            </td>
        `;
        tbody.appendChild(row);
        bindTriggerInputs(row, index);
    });

    if (!profile.triggers.length) {
        const emptyRow = document.createElement("tr");
        emptyRow.innerHTML = `<td colspan="3" class="cs-empty">No triggers yet. Link a keyword to a variant so you can call it instantly.</td>`;
        tbody.appendChild(emptyRow);
    }
}

function addVariant(variant = { name: "", folder: "" }) {
    const profile = getActiveProfile();
    profile.variants.push(normalizeVariantEntry(variant));
    scheduleAutoSave({ key: "variants", noticeKey: "variants" });
    renderVariants();
    renderTriggers();
}

function removeVariant(index) {
    const profile = getActiveProfile();
    profile.variants.splice(index, 1);
    scheduleAutoSave({ key: "variants", noticeKey: "variants" });
    renderVariants();
    renderTriggers();
}

function bindVariantInputs(row, index) {
    const nameInput = row.querySelector(".cs-variant-name");
    const folderInput = row.querySelector(".cs-variant-folder");
    const runButton = row.querySelector(".cs-variant-run");
    const deleteButton = row.querySelector(".cs-variant-delete");
    const folderButton = row.querySelector(".cs-variant-folder-select");

    const profile = getActiveProfile();
    nameInput.value = profile.variants[index].name;
    folderInput.value = profile.variants[index].folder;

    nameInput.addEventListener("input", (event) => {
        const activeProfile = getActiveProfile();
        activeProfile.variants[index].name = event.target.value;
        scheduleAutoSave({ key: "variants", element: event.target });
    });

    folderInput.addEventListener("input", (event) => {
        const activeProfile = getActiveProfile();
        activeProfile.variants[index].folder = event.target.value;
        scheduleAutoSave({ key: "variants", element: event.target });
    });

    runButton.addEventListener("click", async () => {
        flushAutoSave({ showStatusMessage: false });
        if (!settings.enabled) {
            showStatus("Enable Outfit Switcher to use variants.", "error");
            return;
        }
        const activeProfile = getActiveProfile();
        const targetFolder = composeCostumePath(activeProfile.baseFolder, activeProfile.variants[index].folder);
        const result = await issueCostume(targetFolder, { source: "ui" });
        if (result.toLowerCase().startsWith("please provide")) {
            showStatus("Set the base folder or variant folder before running.", "error");
        }
    });

    deleteButton.addEventListener("click", () => {
        removeVariant(index);
    });

    attachFolderPicker(folderButton, folderInput, { mode: "relative" });
}

function renderVariants() {
    const tbody = getElement("#os-variant-table-body");
    if (!tbody) {
        return;
    }

    tbody.innerHTML = "";
    const profile = getActiveProfile();

    profile.variants.forEach((variant, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><input type="text" class="text_pole cs-variant-name" placeholder="e.g., Winter Casual" /></td>
            <td>
                <div class="cs-folder-picker">
                    <input type="text" class="text_pole cs-variant-folder" placeholder="Subfolder (e.g., winter/casual)" />
                    <button type="button" class="menu_button interactable cs-button-ghost cs-folder-button cs-variant-folder-select">
                        <i class="fa-solid fa-folder-open"></i>
                        <span>Pick Folder</span>
                    </button>
                </div>
            </td>
            <td class="cs-variant-actions">
                <button type="button" class="menu_button interactable cs-variant-run">Run</button>
                <button type="button" class="menu_button interactable cs-variant-delete">Remove</button>
            </td>
        `;
        tbody.appendChild(row);
        bindVariantInputs(row, index);
    });

    if (!profile.variants.length) {
        const emptyRow = document.createElement("tr");
        emptyRow.innerHTML = `<td colspan="3" class="cs-empty">No variants yet. Add a look so you can trigger it without browsing folders.</td>`;
        tbody.appendChild(emptyRow);
    }
}

function handleBaseFolderInput(event) {
    const profile = getActiveProfile();
    profile.baseFolder = event.target.value.trim();
    scheduleAutoSave({ key: "baseFolder", element: event.target });
    updateProfilePill();
}

async function runTriggerByName(triggerName, source = "slash") {
    flushAutoSave({ showStatusMessage: false });
    if (!settings.enabled) {
        const disabledMessage = "Outfit Switcher is disabled for the focus character.";
        if (source === "slash") {
            return disabledMessage;
        }
        showStatus(disabledMessage, "error");
        return disabledMessage;
    }

    const costume = findCostumeForTrigger(settings, triggerName);
    if (!costume) {
        const unknownMessage = `No outfit trigger named "${escapeHtml(triggerName || "")}".`;
        if (source === "slash") {
            return unknownMessage;
        }
        showStatus(unknownMessage, "error");
        return unknownMessage;
    }

    return issueCostume(costume, { source });
}

function bindUI() {
    const enableCheckbox = getElement("#os-enable");
    const baseFolderInput = getElement("#os-base-folder");
    const baseFolderButton = getElement("#os-base-folder-select");
    const addVariantButton = getElement("#os-add-variant");
    const addTriggerButton = getElement("#os-add-trigger");
    const runBaseButton = getElement("#os-run-base");
    uiState.profileSelect = getElement("#os-profile-select");
    uiState.profilePill = getElement("#os-profile-pill");
    uiState.profileCreateButton = getElement("#os-profile-create");
    uiState.profileDuplicateButton = getElement("#os-profile-duplicate");
    uiState.profileRenameButton = getElement("#os-profile-rename");
    uiState.profileDeleteButton = getElement("#os-profile-delete");
    uiState.profileExportButton = getElement("#os-profile-export");
    uiState.profileImportButton = getElement("#os-profile-import");
    uiState.profileImportInput = getElement("#os-profile-import-file");

    if (enableCheckbox) {
        enableCheckbox.checked = settings.enabled;
        enableCheckbox.addEventListener("change", handleEnableToggle);
    }

    if (baseFolderInput) {
        uiState.baseFolderInput = baseFolderInput;
        baseFolderInput.addEventListener("input", handleBaseFolderInput);
    }

    attachFolderPicker(baseFolderButton, baseFolderInput, { mode: "absolute" });

    if (addVariantButton) {
        addVariantButton.addEventListener("click", () => addVariant());
    }

    if (addTriggerButton) {
        addTriggerButton.addEventListener("click", () => addTriggerRow());
    }

    if (runBaseButton) {
        runBaseButton.addEventListener("click", async () => {
            flushAutoSave({ showStatusMessage: false });
            if (!settings.enabled) {
                showStatus("Enable Outfit Switcher to run the base folder.", "error");
                return;
            }
            const profile = getActiveProfile();
            if (!profile.baseFolder) {
                showStatus("Set a base folder before running it.", "error");
                return;
            }
            await issueCostume(profile.baseFolder, { source: "ui" });
        });
    }

    if (uiState.profileSelect) {
        uiState.profileSelect.addEventListener("change", handleProfileSelectChange);
    }

    if (uiState.profileCreateButton) {
        uiState.profileCreateButton.addEventListener("click", handleCreateProfile);
    }

    if (uiState.profileDuplicateButton) {
        uiState.profileDuplicateButton.addEventListener("click", handleDuplicateProfile);
    }

    if (uiState.profileRenameButton) {
        uiState.profileRenameButton.addEventListener("click", handleRenameProfile);
    }

    if (uiState.profileDeleteButton) {
        uiState.profileDeleteButton.addEventListener("click", handleDeleteProfile);
    }

    if (uiState.profileExportButton) {
        uiState.profileExportButton.addEventListener("click", handleExportProfile);
    }

    if (uiState.profileImportButton && uiState.profileImportInput) {
        uiState.profileImportButton.addEventListener("click", () => uiState.profileImportInput.click());
    }

    if (uiState.profileImportInput) {
        uiState.profileImportInput.addEventListener("change", handleProfileImport);
    }

    refreshProfileUI();
}

function initSlashCommand() {
    const slashConfig = getOutfitSlashCommandConfig();

    registerSlashCommand(
        slashConfig.name,
        async (args) => {
            const triggerText = Array.isArray(args) ? args.join(" ") : String(args ?? "");
            return runTriggerByName(triggerText, "slash");
        },
        slashConfig.args,
        slashConfig.description,
        false,
    );
}

async function init() {
    settings = ensureSettingsShape(extension_settings[extensionName] || defaultSettings);
    extension_settings[extensionName] = settings;

    try {
        await ensureSettingsPanel();
    } catch (error) {
        console.error(`${logPrefix} Unable to initialize settings panel`, error);
        return;
    }
    await populateBuildMeta();
    bindUI();
    registerAutomationHandlers();
    showStatus("Ready", "info");
}

initSlashCommand();

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
        flushAutoSave({ showStatusMessage: false, force: true });
        teardownAutomationHandlers();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        init();
    });
} else {
    init();
}
