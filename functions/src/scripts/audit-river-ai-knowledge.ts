#!/usr/bin/env ts-node
/**
 * Audits River AI knowledge sources from the manifest.
 * Run after feature ships: npm run audit:river-ai-knowledge
 */
import * as fs from "fs";
import * as path from "path";
import {
  RIVER_AI_KNOWLEDGE_MANIFEST_VERSION,
  RIVER_AI_KNOWLEDGE_SOURCES,
} from "../services/ai/river-ai-knowledge-manifest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function resolveRepoPath(relativePath: string): string {
  return path.join(REPO_ROOT, relativePath);
}

function main(): void {
  const missingDocs: string[] = [];
  const missingHooks: string[] = [];

  for (const source of RIVER_AI_KNOWLEDGE_SOURCES) {
    const docPath = resolveRepoPath(source.path);
    if (!fs.existsSync(docPath)) {
      missingDocs.push(source.path);
    }
    for (const hook of source.codeHooks) {
      const hookPath = resolveRepoPath(hook);
      if (!fs.existsSync(hookPath)) {
        missingHooks.push(hook);
      }
    }
  }

  console.log(`River AI knowledge audit (manifest ${RIVER_AI_KNOWLEDGE_MANIFEST_VERSION})`);
  console.log(`Sources checked: ${RIVER_AI_KNOWLEDGE_SOURCES.length}`);

  if (missingDocs.length === 0 && missingHooks.length === 0) {
    console.log("OK — all manifest paths exist.");
    console.log("");
    console.log("When you ship a feature, also:");
    console.log("  1. Update frontend/docs/app-feature-capabilities.md + release-notes-business.md");
    console.log("  2. Patch product-documentation-knowledge.ts and/or support-knowledge-catalog.ts");
    console.log("  3. Bump RIVER_AI_KNOWLEDGE_MANIFEST_VERSION if sources changed");
    console.log("  4. Re-run this audit");
    process.exit(0);
  }

  if (missingDocs.length) {
    console.error("\nMissing doc paths:");
    for (const p of missingDocs) console.error(`  - ${p}`);
  }
  if (missingHooks.length) {
    console.error("\nMissing code hooks:");
    for (const p of missingHooks) console.error(`  - ${p}`);
  }
  process.exit(1);
}

main();
