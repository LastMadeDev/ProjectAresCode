#!/usr/bin/env node
// Merge upstream T3 Code (`--ref`, default main; `--push` when clean). A conflict whose Ares
// side equals rebrand(base) becomes rebrand(upstream); anything else stops the merge.
// Exit 0 merged or current, 2 real conflicts, 3 a brand rule went stale (see ARES.md).

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const { execFileSync, spawnSync } = NodeChildProcess;
const { writeFileSync } = NodeFS;
const { join } = NodePath;

import {
  ASSET_TARGETS,
  REPO_ROOT,
  formatFiles,
  rebrandText,
  run as runRebrand,
  squash,
} from "./rebrand.mjs";

const UPSTREAM_URL = "https://github.com/pingdotgg/t3code.git";

const args = process.argv.slice(2);
const push = args.includes("--push");
const refIndex = args.indexOf("--ref");
const upstreamRef = refIndex >= 0 ? args[refIndex + 1] : "main";

function git(argv, options = {}) {
  return execFileSync("git", argv, {
    cwd: REPO_ROOT,
    encoding: options.buffer ? undefined : "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "inherit"],
  });
}

function gitOk(argv) {
  return spawnSync("git", argv, { cwd: REPO_ROOT, stdio: "ignore" }).status === 0;
}

const lf = (text) => text.replace(/\r\n/g, "\n");

function stageBlobs(file) {
  const out = git(["ls-files", "-u", "-z", "--", file]);
  const stages = {};
  for (const entry of out.split("\0").filter(Boolean)) {
    const [meta] = entry.split("\t");
    const [, sha, stage] = meta.split(" ");
    stages[stage] = sha;
  }
  const read = (sha) =>
    sha ? git(["cat-file", "blob", sha], { buffer: true }).toString("utf8") : null;
  return { base: read(stages[1]), ours: read(stages[2]), theirs: read(stages[3]) };
}

function resolveConflict(file) {
  if (ASSET_TARGETS.has(file)) {
    // Ares owns these bytes; rebrand copies the Ares asset back over upstream's.
    if (gitOk(["checkout", "--theirs", "--", file])) git(["add", "--", file]);
    else git(["rm", "-q", "--", file]);
    return true;
  }

  const { base, ours, theirs } = stageBlobs(file);
  if (base === null || ours === null) return false;
  // Formatting-insensitive: our committed side was run through the formatter.
  if (squash(rebrandText(file, base)) !== squash(ours)) return false;

  if (theirs === null) {
    git(["rm", "-q", "--", file]);
    return true;
  }
  writeFileSync(join(REPO_ROOT, file), lf(rebrandText(file, theirs)));
  git(["add", "--", file]);
  resolvedText.push(file);
  return true;
}

const resolvedText = [];

function main() {
  if (git(["status", "--porcelain"]).trim()) {
    console.error("Working tree is not clean. Commit or stash first.");
    process.exit(1);
  }

  if (!gitOk(["remote", "get-url", "upstream"])) {
    git(["remote", "add", "upstream", UPSTREAM_URL]);
    git(["remote", "set-url", "--push", "upstream", "NO_PUSH_TO_UPSTREAM"]);
  }
  git(["fetch", "--no-tags", "upstream", `+refs/heads/main:refs/remotes/upstream/main`]);
  const target = upstreamRef === "main" ? "upstream/main" : upstreamRef;
  if (upstreamRef !== "main" && !gitOk(["rev-parse", "--verify", "--quiet", target])) {
    git(["fetch", "--no-tags", "upstream", `${upstreamRef}`]);
  }
  const targetSha = git(["rev-parse", target]).trim();
  const short = targetSha.slice(0, 10);

  if (gitOk(["merge-base", "--is-ancestor", targetSha, "HEAD"])) {
    console.log(`Already contains upstream ${short}.`);
    return;
  }

  const behind = git(["rev-list", "--count", `HEAD..${targetSha}`]).trim();
  console.log(`Merging ${behind} upstream commit(s) up to ${short}...`);
  const merge = spawnSync(
    "git",
    ["merge", "--no-ff", "--no-commit", "-m", `chore(ares): merge upstream ${short}`, targetSha],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );

  const conflicted = git(["diff", "--name-only", "--diff-filter=U", "-z"])
    .split("\0")
    .filter(Boolean);
  if (merge.status !== 0 && conflicted.length === 0) {
    console.error("git merge failed without conflicts; see the output above.");
    process.exit(1);
  }

  const unresolved = conflicted.filter((file) => !resolveConflict(file));
  if (conflicted.length) {
    console.log(
      `Brand-only conflicts resolved: ${conflicted.length - unresolved.length}/${conflicted.length}`,
    );
  }
  if (unresolved.length) {
    console.error("\nReal conflicts (Ares feature edits overlap upstream changes):");
    for (const file of unresolved) console.error(`  ${file}`);
    console.error(
      "\nResolve them, then run:\n  node ares/rebrand.mjs && git add -A && git commit --no-edit\n" +
        "Or abort with: git merge --abort",
    );
    process.exit(2);
  }

  const { changed, stale } = runRebrand({ check: false });
  if (stale.length) {
    for (const s of stale) console.error(`stale rule: ${s}`);
    console.error(
      "\nUpstream moved code a brand rule targets. Update the rule in ares/rebrand.mjs, then run:\n" +
        "  node ares/rebrand.mjs && git add -A && git commit --no-edit\nOr abort with: git merge --abort",
    );
    process.exit(3);
  }
  console.log(`Brand layer re-applied to ${changed.length} file(s).`);
  if (resolvedText.length) formatFiles(resolvedText);

  git(["add", "-A"]);
  git(["commit", "--no-edit", "-q"]);
  console.log(`Merged upstream ${short}.`);

  if (push) {
    git(["push", "origin", "HEAD"]);
    console.log("Pushed.");
  }
}

main();
