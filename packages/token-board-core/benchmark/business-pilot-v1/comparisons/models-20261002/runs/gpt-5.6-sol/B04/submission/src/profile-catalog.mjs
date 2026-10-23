// Historical catalog and lease-reading functions; writes/process cleanup are omitted.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const SAFE_SESSION_RE = /^[A-Za-z0-9._-]+$/;
const LEASE_VERSION = 1;
const RUNTIME_SNAPSHOT_VERSION = 1;
const RUNTIME_SNAPSHOT_MAX_AGE_MS = 30_000;
const GATEWAY_STATE_VERSION = 1;
export function findAvailableAgentBrowserProfileCandidatesSync(input, homeDir = os.homedir(), now = Date.now()) {
    return listAgentBrowserProfileCatalogSync(input, homeDir, now).filter((profile)=>profile.available).map(({ available: _available, unavailableReason: _reason, occupancy: _occupancy, ...profile })=>profile).sort((a, b)=>a.cdpPort - b.cdpPort);
}
export function listAgentBrowserProfileCatalogSync(input = {}, homeDir = os.homedir(), now = Date.now()) {
    const registeredProfiles = readRegisteredAgentBrowserProfilesSync(homeDir);
    const snapshot = readAgentBrowserRuntimeProfilesSync(homeDir);
    const updatedAt = snapshot ? Date.parse(snapshot.updatedAt) : Number.NaN;
    const snapshotIsFresh = snapshot && Number.isFinite(updatedAt) && now - updatedAt <= RUNTIME_SNAPSHOT_MAX_AGE_MS;
    const runtimeByProfileId = new Map((snapshotIsFresh ? snapshot.profiles : []).map((profile)=>[
            profile.profileId,
            profile
        ]));
    const requestedSession = safeSessionName(input.requestedSession);
    return registeredProfiles.map((registered)=>{
        const runtime = runtimeByProfileId.get(registered.profileId);
        if (!runtime) return registered;
        const merged = {
            ...runtime,
            ...registered,
            running: runtime.running
        };
        if (!registered.agentAccessDisabled) delete merged.agentAccessDisabled;
        return merged;
    }).filter((profile)=>profile.cdpPort !== input.excludedPort).map((profile)=>{
        const occupancy = readActiveAgentBrowserProfileOccupancySync(profile.cdpPort, homeDir, now);
        const alreadyOwnedBySession = Boolean(occupancy && requestedSession && occupancy.session === requestedSession);
        const unavailableReason = profile.agentAccessDisabled ? "agent_access_disabled" : occupancy && !alreadyOwnedBySession ? "occupied" : null;
        return {
            ...profile,
            available: unavailableReason === null,
            alreadyOwnedBySession,
            unavailableReason,
            occupancy
        };
    }).sort((a, b)=>a.cdpPort - b.cdpPort);
}

function readRegisteredAgentBrowserProfilesSync(homeDir) {
    for (const registryPath of profileRegistryCandidates(process.env, homeDir)){
        try {
            const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
            if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.profiles)) continue;
            return normalizeRegisteredProfiles(parsed.profiles, registryPath);
        } catch  {
            // A missing or malformed legacy location must not hide a later valid registry.
        }
    }
    return [];
}

function normalizeRegisteredProfiles(input, registryPath) {
    const profiles = [];
    const seenIds = new Set();
    const seenPorts = new Set();
    const profilesRoot = path.resolve(path.dirname(registryPath), "profiles");
    const containmentPrefix = profilesRoot.endsWith(path.sep) ? profilesRoot : `${profilesRoot}${path.sep}`;
    for (const item of input){
        if (!item || typeof item !== "object") continue;
        const id = nonEmptyString(item.id);
        const profileName = nonEmptyString(item.name);
        const dirName = nonEmptyString(item.dirName);
        const fixedPort = normalizePort(item.fixedCdpPort);
        const lastPort = normalizePort(item.lastCdpPort);
        const cdpPort = fixedPort || lastPort;
        if (!id || !profileName || !dirName || !cdpPort || seenIds.has(id) || seenPorts.has(cdpPort)) continue;
        const userDataDir = path.resolve(profilesRoot, dirName);
        const contained = process.platform === "win32" ? userDataDir.toLowerCase().startsWith(containmentPrefix.toLowerCase()) : userDataDir.startsWith(containmentPrefix);
        if (!contained) continue;
        seenIds.add(id);
        seenPorts.add(cdpPort);
        const profile = {
            profileId: `isolated:${id}`,
            profileName,
            cdpPort,
            running: false,
            source: "isolated",
            userDataDir
        };
        if (item.agentAccessDisabled === true) profile.agentAccessDisabled = true;
        const clonedFromProfileId = nonEmptyString(item.clonedFromProfileId);
        if (clonedFromProfileId) profile.clonedFromProfileId = clonedFromProfileId;
        const projectTag = nonEmptyString(item.projectTag);
        if (projectTag) profile.projectTag = projectTag;
        const lastLaunchedAt = nonEmptyString(item.lastLaunchedAt);
        if (lastLaunchedAt) profile.lastLaunchedAt = lastLaunchedAt;
        profiles.push(profile);
    }
    return profiles.sort((a, b)=>a.cdpPort - b.cdpPort);
}
export function readAgentBrowserRuntimeProfilesSync(homeDir = os.homedir()) {
    try {
        const parsed = JSON.parse(readFileSync(agentBrowserRuntimeProfilesPath(homeDir), "utf8"));
        if (parsed.version !== RUNTIME_SNAPSHOT_VERSION || typeof parsed.updatedAt !== "string" || !Array.isArray(parsed.profiles)) {
            return null;
        }
        return {
            version: RUNTIME_SNAPSHOT_VERSION,
            updatedAt: parsed.updatedAt,
            profiles: normalizeRuntimeProfiles(parsed.profiles)
        };
    } catch  {
        return null;
    }
}
export function agentBrowserRuntimeProfilesPath(homeDir = os.homedir()) {
    return path.join(homeDir, ".profilepilot", "runtime-profiles.json");
}
function normalizeRuntimeProfiles(input) {
    const profiles = [];
    const seenPorts = new Set();
    for (const item of input){
        if (!item || typeof item !== "object") {
            continue;
        }
        const candidate = item;
        const profileId = nonEmptyString(candidate.profileId);
        const profileName = nonEmptyString(candidate.profileName);
        const cdpPort = normalizePort(Number(candidate.cdpPort));
        if (!profileId || !profileName || !cdpPort || seenPorts.has(cdpPort)) {
            continue;
        }
        seenPorts.add(cdpPort);
        const profile = {
            profileId,
            profileName,
            cdpPort,
            running: candidate.running !== false
        };
        const source = nonEmptyString(candidate.source);
        if (source) profile.source = source;
        const clonedFromProfileId = nonEmptyString(candidate.clonedFromProfileId);
        if (clonedFromProfileId) profile.clonedFromProfileId = clonedFromProfileId;
        const projectTag = nonEmptyString(candidate.projectTag);
        if (projectTag) profile.projectTag = projectTag;
        if (candidate.agentAccessDisabled === true) profile.agentAccessDisabled = true;
        const lastLaunchedAt = nonEmptyString(candidate.lastLaunchedAt);
        if (lastLaunchedAt) profile.lastLaunchedAt = lastLaunchedAt;
        profiles.push(profile);
    }
    return profiles.sort((a, b)=>a.cdpPort - b.cdpPort);
}
export function readActiveAgentBrowserProfileOccupancySync(cdpPort, homeDir = os.homedir(), now = Date.now()) {
    const lease = readAgentBrowserProfileLeaseSync(cdpPort, homeDir);
    if (!lease || !isAgentBrowserProfileLeaseActive(lease, now, homeDir)) return null;
    return {
        cdpPort: lease.cdpPort,
        profileId: lease.profileId,
        profileName: lease.profileName,
        session: lease.session,
        ownership: lease.delegatedToUser ? "user" : "agent",
        agent: lease.agent || null,
        project: lease.project || null,
        command: lease.command || null,
        holderPid: lease.holderPid,
        daemonPid: lease.daemonPid || null,
        updatedAt: lease.updatedAt
    };
}
export function readAgentBrowserProfileLeaseSync(cdpPort, homeDir = os.homedir()) {
    const port = normalizePort(cdpPort);
    return port ? readAgentBrowserProfileLeaseFileSync(agentBrowserProfileLeasePath(homeDir, port)) : null;
}
export function agentBrowserProfileLeasePath(homeDir, cdpPort) {
    return path.join(agentBrowserProfileLeaseDir(homeDir), `cdp-${cdpPort}.json`);
}
export function agentBrowserProfileLeaseDir(homeDir = os.homedir()) {
    return path.join(homeDir, ".profilepilot", "profile-leases");
}
function readAgentBrowserProfileLeaseFileSync(filePath) {
    try {
        return normalizeLease(JSON.parse(readFileSync(filePath, "utf8")));
    } catch  {
        return null;
    }
}
function normalizeLease(input) {
    const cdpPort = normalizePort(Number(input.cdpPort));
    const session = safeSessionName(input.session);
    const holderPid = normalizePid(Number(input.holderPid));
    const profileId = nonEmptyString(input.profileId);
    const profileName = nonEmptyString(input.profileName);
    const acquiredAt = nonEmptyString(input.acquiredAt);
    const updatedAt = nonEmptyString(input.updatedAt);
    const expiresAt = nonEmptyString(input.expiresAt);
    if (input.version !== LEASE_VERSION || !cdpPort || !session || !holderPid || !profileId || !profileName || !acquiredAt || !updatedAt || !expiresAt) {
        return null;
    }
    const lease = {
        version: LEASE_VERSION,
        cdpPort,
        profileId,
        profileName,
        session,
        holderPid,
        acquiredAt,
        updatedAt,
        expiresAt
    };
    const daemonPid = normalizePid(Number(input.daemonPid));
    if (daemonPid) lease.daemonPid = daemonPid;
    if (input.delegatedToUser === true) lease.delegatedToUser = true;
    const agent = nonEmptyString(input.agent);
    if (agent) lease.agent = agent;
    const project = nonEmptyString(input.project);
    if (project) lease.project = project;
    const branch = nonEmptyString(input.branch);
    if (branch) lease.branch = branch;
    const command = nonEmptyString(input.command);
    if (command) lease.command = command;
    return lease;
}
export function isAgentBrowserProfileLeaseActive(lease, now = Date.now(), homeDir = os.homedir()) {
    if (lease.delegatedToUser) {
        const gatewayOwnership = readGatewayActiveOwnershipSync(lease.cdpPort, homeDir);
        if (gatewayOwnership !== undefined) {
            return gatewayOwnership?.ownerSessionId === lease.session;
        }
        return true;
    }
    if (isProcessAlive(lease.holderPid)) {
        return true;
    }
    const expiresAt = Date.parse(lease.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        return false;
    }
    return lease.daemonPid ? isProcessAlive(lease.daemonPid) : true;
}
function readGatewayActiveOwnershipSync(cdpPort, homeDir) {
    const gatewayDir = path.join(homeDir, ".profilepilot", "gateway");
    const daemonPid = readPidFileSync(path.join(gatewayDir, "daemon.pid"));
    if (!daemonPid || !isProcessAlive(daemonPid)) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(readFileSync(path.join(gatewayDir, "state.json"), "utf8"));
        if (parsed.version !== GATEWAY_STATE_VERSION || !Array.isArray(parsed.profiles)) {
            return undefined;
        }
        const active = parsed.profiles.find((profile)=>Number(profile.publicPort) === cdpPort && profile.sessionStatus === "active" && safeSessionName(typeof profile.ownerSessionId === "string" ? profile.ownerSessionId : undefined) !== undefined && gatewayChromeRouteMayStillBeLive(profile.chromePid));
        const ownerSessionId = active ? safeSessionName(typeof active.ownerSessionId === "string" ? active.ownerSessionId : undefined) : undefined;
        return active && ownerSessionId ? {
            ownerSessionId,
            publicPort: cdpPort
        } : null;
    } catch  {
        return undefined;
    }
}
function gatewayChromeRouteMayStillBeLive(chromePidInput) {
    const chromePid = normalizePid(Number(chromePidInput));
    return chromePid ? isProcessAlive(chromePid) : true;
}
function readPidFileSync(filePath) {
    try {
        return normalizePid(Number(readFileSync(filePath, "utf8").trim()));
    } catch  {
        return undefined;
    }
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return errorCode(error) === "EPERM";
    }
}
function normalizePort(value) {
    return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined;
}
function normalizePid(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
function safeSessionName(value) {
    const trimmed = nonEmptyString(value);
    return trimmed && SAFE_SESSION_RE.test(trimmed) ? trimmed : undefined;
}
function nonEmptyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function errorCode(error) {
    return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}
function profileRegistryCandidates(env, homeDir) {
    const roots = [];
    const explicitDataDir = nonEmptyString(env.CPM_DATA_DIR);
    if (explicitDataDir) roots.push(explicitDataDir);
    if (process.platform === "darwin") {
        roots.push(path.join(homeDir, "Library", "Application Support", "Codex Chrome Profile Manager"), path.join(homeDir, "Library", "Application Support", "ProfilePilot"));
    } else if (process.platform === "win32") {
        const appData = env.APPDATA || homeDir;
        roots.push(path.join(appData, "Codex Chrome Profile Manager"), path.join(appData, "ProfilePilot"));
    } else {
        const config = env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
        roots.push(path.join(config, "codex-chrome-profile-manager"), path.join(config, "profilepilot"));
    }
    return [
        ...new Set(roots)
    ].map((root)=>path.join(root, "profiles.json"));
}
