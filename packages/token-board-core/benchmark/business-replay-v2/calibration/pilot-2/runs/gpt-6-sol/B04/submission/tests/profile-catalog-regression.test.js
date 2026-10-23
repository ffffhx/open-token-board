const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildSync } = require("esbuild");

const source = path.resolve(__dirname, "../src/main/agent-browser-lease.ts");
const bundled = buildSync({ entryPoints: [source], bundle: true, platform: "node", format: "cjs", target: "node22", write: false }).outputFiles[0].text;
const compiled = new Module(source, module);
compiled.filename = source;
compiled.paths = Module._nodeModulePaths(path.dirname(source));
compiled._compile(bundled, source);
const lease = compiled.exports;

test("catalog joins current registration with only matching fresh observations and honors leases", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "profilepilot-catalog-"));
  const dataDir = path.join(home, "custom-data");
  const registryPath = path.join(dataDir, "profiles.json");
  const previousDataDir = process.env.CPM_DATA_DIR;
  const previousAppData = process.env.APPDATA;
  const now = Date.now();
  const profiles = [
    { id: "work", name: "Original", dirName: "work", fixedCdpPort: 9223 },
    { id: "private", name: "Private", dirName: "private", fixedCdpPort: 9224, agentAccessDisabled: true },
    { id: "other", name: "Other", dirName: "nested/other", fixedCdpPort: 9225 },
    { id: "bad-path", name: "Bad path", dirName: "../outside", fixedCdpPort: 9226 },
    { id: "bad-port", name: "Bad port", dirName: "bad-port", fixedCdpPort: 99999 },
    { id: "occupied", name: "Occupied", dirName: "occupied", fixedCdpPort: 9227 }
  ];
  try {
    mkdirSync(dataDir, { recursive: true });
    process.env.CPM_DATA_DIR = dataDir;
    process.env.APPDATA = home;
    writeFileSync(registryPath, JSON.stringify({ profiles }));
    lease.writeAgentBrowserRuntimeProfilesSync([
      { profileId: "isolated:someone-else", profileName: "Wrong", cdpPort: 9223, running: true },
      { profileId: "external:live", profileName: "External", cdpPort: 9230, running: true }
    ], home, now);
    lease.acquireAgentBrowserProfileLeaseSync({
      cdpPort: 9227, session: "cx-owner", holderPid: process.pid,
      profileId: "isolated:occupied", profileName: "Occupied"
    }, home, now);

    let catalog = lease.listAgentBrowserProfileCatalogSync({ requestedSession: "cx-visitor" }, home, now + 1000);
    assert.deepEqual(catalog.map((entry) => entry.cdpPort), [9223, 9224, 9225, 9227, 9230]);
    assert.equal(catalog.find((entry) => entry.cdpPort === 9223).running, false);
    assert.equal(catalog.find((entry) => entry.cdpPort === 9224).unavailableReason, "agent_access_disabled");
    assert.equal(catalog.find((entry) => entry.cdpPort === 9227).unavailableReason, "occupied");
    assert.equal(catalog.find((entry) => entry.cdpPort === 9230).running, true);
    assert.equal(lease.findConfiguredAgentBrowserProfileByPortSync(9225, process.env, home).userDataDir,
      path.join(dataDir, "profiles", "nested", "other"));

    lease.writeAgentBrowserRuntimeProfilesSync([
      { profileId: "isolated:work", profileName: "Old snapshot name", cdpPort: 9223, running: true },
      { profileId: "external:live", profileName: "External", cdpPort: 9230, running: true }
    ], home, now + 1500);
    catalog = lease.listAgentBrowserProfileCatalogSync({}, home, now + 1600);
    assert.equal(catalog.find((entry) => entry.cdpPort === 9223).running, true);
    assert.equal(catalog.find((entry) => entry.cdpPort === 9223).profileName, "Original");

    profiles[0].name = "Renamed";
    profiles[0].agentAccessDisabled = true;
    writeFileSync(registryPath, JSON.stringify({ profiles }));
    catalog = lease.listAgentBrowserProfileCatalogSync({ requestedSession: "cx-owner" }, home, now + 2000);
    assert.equal(catalog.find((entry) => entry.cdpPort === 9223).profileName, "Renamed");
    assert.equal(catalog.find((entry) => entry.cdpPort === 9223).unavailableReason, "agent_access_disabled");
    assert.equal(catalog.find((entry) => entry.cdpPort === 9227).alreadyOwnedBySession, true);

    const afterExpiry = lease.listAgentBrowserProfileCatalogSync({ requestedSession: "cx-owner", excludedPort: 9224 }, home, now + 32_000);
    assert.deepEqual(afterExpiry.map((entry) => entry.cdpPort), [9223, 9225, 9227]);
    assert.deepEqual(lease.findAvailableAgentBrowserProfileCandidatesSync({ requestedSession: "cx-owner", excludedPort: 9223 }, home, now + 32_000)
      .map((entry) => entry.cdpPort), [9225, 9227]);

    rmSync(lease.agentBrowserRuntimeProfilesPath(home), { force: true });
    assert.deepEqual(lease.listAgentBrowserProfileCatalogSync({}, home, now + 32_000).map((entry) => entry.cdpPort),
      [9223, 9224, 9225, 9227]);
  } finally {
    if (previousDataDir === undefined) delete process.env.CPM_DATA_DIR;
    else process.env.CPM_DATA_DIR = previousDataDir;
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    rmSync(home, { recursive: true, force: true });
  }
});
