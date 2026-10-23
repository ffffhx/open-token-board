import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
      : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const percentile95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

const baseline = read("artifacts/baseline-measurement.json");
const candidate = read("artifacts/measurement.json");
const baselineMs = baseline.samples.map((sample) => sample.durationMs);
const candidateMs = candidate.samples.map((sample) => sample.durationMs);
const pairedDiffs = baselineMs.map((value, index) => value - candidateMs[index]);
const diffMedian = median(pairedDiffs);
const diffMad = median(pairedDiffs.map((value) => Math.abs(value - diffMedian)));
const reads = (measurement) => measurement.samples.flatMap((sample) => sample.reads);
const baselineReads = reads(baseline);
const candidateReads = reads(candidate);
const baselineHash = digest(baseline.entries);
const candidateHash = digest(candidate.entries);
const report = {
  events: candidate.events,
  baselineEntries: baseline.entries.length,
  candidateEntries: candidate.entries.length,
  baselineSnapshotSha256: baselineHash,
  candidateSnapshotSha256: candidateHash,
  allSnapshotsEqual: baselineHash === candidateHash,
  baselineMs,
  candidateMs,
  baselineMedianMs: median(baselineMs),
  candidateMedianMs: median(candidateMs),
  medianImprovementPercent: (1 - median(candidateMs) / median(baselineMs)) * 100,
  pairedDiffsMs: pairedDiffs,
  pairedImprovementCount: pairedDiffs.filter((value) => value > 0).length,
  pairedDiffMedianMs: diffMedian,
  pairedDiffMadMs: diffMad,
  pairedDiffExceeds3Mad: diffMedian > 3 * diffMad,
  baselineReadP95Ms: percentile95(baselineReads.map((read) => read.ms)),
  candidateReadP95Ms: percentile95(candidateReads.map((read) => read.ms)),
  candidateReadCount: candidateReads.length,
  candidateReadStatuses: [...new Set(candidateReads.map((read) => read.status))],
  candidateReadFailures: candidateReads.filter((read) => read.status !== 200 || read.error),
};
console.log(JSON.stringify(report, null, 2));
if (
  !report.allSnapshotsEqual ||
  report.medianImprovementPercent < 15 ||
  report.pairedImprovementCount < 6 ||
  !report.pairedDiffExceeds3Mad ||
  report.candidateReadP95Ms > Math.max(100, report.baselineReadP95Ms * 1.3) ||
  report.candidateReadFailures.length > 0
) {
  process.exitCode = 1;
}
