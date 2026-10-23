// In-memory filesystem and process-liveness adapter: cannot touch a real Profile.
import vm from 'node:vm';
import path from 'node:path';
export function catalogFixture(source, platform = 'win32') {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const home = platform === 'win32' ? 'C:\\fixture-home' : '/fixture-home';
  const files = new Map();
  const now = Date.parse('2026-09-22T12:00:00Z');
  const process = {
    platform, env: {}, pid: 424242,
    kill(pid, signal) {
      if (signal !== 0) throw Error('Fixture only supports liveness probes');
      if (pid !== this.pid) throw Object.assign(Error('No fixture process'), { code: 'ESRCH' });
    }
  };
  const readFileSync = filename => {
    if (!files.has(filename)) throw Object.assign(Error('Missing fixture file'), { code: 'ENOENT' });
    return files.get(filename);
  };
  const code = source.replace(/^import .*;\r?$/gm, '').replace(/\bexport (?=function )/g, '') +
    '\n;({listAgentBrowserProfileCatalogSync,findAvailableAgentBrowserProfileCandidatesSync});';
  const api = vm.runInNewContext(code, { readFileSync, os: { homedir: () => home }, path: paths, process }, { timeout: 3000 });
  const writeJson = (file, value) => files.set(file, JSON.stringify(value));
  const standardRoot = platform === 'win32' ? paths.join(home, 'ProfilePilot') : platform === 'darwin'
    ? paths.join(home, 'Library', 'Application Support', 'ProfilePilot') : paths.join(home, '.config', 'profilepilot');
  return {
    api, home, now, paths, files, standardRoot,
    registry(profiles, root = standardRoot) { writeJson(paths.join(root, 'profiles.json'), { profiles }); },
    snapshot(profiles, age = 0) { writeJson(paths.join(home, '.profilepilot', 'runtime-profiles.json'), { version: 1, updatedAt: new Date(now - age).toISOString(), profiles }); },
    lease(port, session, name = 'Fixture occupied') {
      writeJson(paths.join(home, '.profilepilot', 'profile-leases', `cdp-${port}.json`), {
        version: 1, cdpPort: port, profileId: `isolated:p-${port}`, profileName: name,
        session, holderPid: process.pid, acquiredAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString()
      });
    }
  };
}
