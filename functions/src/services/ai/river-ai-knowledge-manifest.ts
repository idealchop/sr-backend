/**
 * Canonical sources River AI knowledge must stay aligned with.
 * Updated by `npm run audit:river-ai-knowledge` and the river-ai-knowledge-curator agent.
 */
export const RIVER_AI_KNOWLEDGE_MANIFEST_VERSION = "2026-07-06";

export type RiverAiKnowledgeSource = {
  id: string;
  path: string;
  purpose: string;
  /** Code files that must change when this doc changes (for CI audit). */
  codeHooks: string[];
};

export const RIVER_AI_KNOWLEDGE_SOURCES: RiverAiKnowledgeSource[] = [
  {
    id: "app-feature-capabilities",
    path: "frontend/docs/app-feature-capabilities.md",
    purpose: "Shipped feature list for encyclopedia + instructor roles",
    codeHooks: [
      "backend/functions/src/services/ai/product-documentation-knowledge.ts",
      "backend/functions/src/services/ai/support-knowledge-catalog.ts",
    ],
  },
  {
    id: "release-notes-business",
    path: "frontend/docs/release-notes-business.md",
    purpose: "Recent behavior changes owners ask about",
    codeHooks: ["backend/functions/src/services/ai/product-documentation-knowledge.ts"],
  },
  {
    id: "frontend-documentation",
    path: "frontend/docs/frontend-documentation.md",
    purpose: "UI routes and owner workflows",
    codeHooks: ["backend/functions/src/services/ai/support-knowledge-catalog.ts"],
  },
  {
    id: "architecture-overview",
    path: "frontend/docs/architecture-overview.md",
    purpose: "Hybrid read model explanations",
    codeHooks: ["backend/functions/src/services/ai/product-documentation-knowledge.ts"],
  },
  {
    id: "workspace-roles",
    path: "frontend/docs/workspace-roles-and-permissions.md",
    purpose: "Who can use River AI, team hub, admin limits",
    codeHooks: ["backend/functions/src/services/ai/support-knowledge-catalog.ts"],
  },
  {
    id: "support-persona",
    path: "backend/functions/src/services/ai/support-persona-roles.ts",
    purpose: "Seven-role Buddy persona prompt",
    codeHooks: ["backend/functions/src/services/support/support-chat-service.ts"],
  },
  {
    id: "equipment-knowledge",
    path: "backend/functions/src/services/ai/support-equipment-knowledge.ts",
    purpose: "Technician / maintenance answers",
    codeHooks: ["backend/functions/src/services/ai/support-knowledge-catalog.ts"],
  },
  {
    id: "water-science-knowledge",
    path: "backend/functions/src/services/ai/support-water-science-knowledge.ts",
    purpose: "Water expert answers",
    codeHooks: ["backend/functions/src/services/ai/support-knowledge-catalog.ts"],
  },
  {
    id: "river-ai-agent-tools",
    path: "backend/functions/src/services/ai/river-ai-agent/river-ai-agent-types.ts",
    purpose: "Staff assistant tool list (read/write drafts)",
    codeHooks: [
      "backend/functions/src/services/ai/river-ai-agent/river-ai-agent-intent.ts",
      "frontend/src/features/dashboard/services/river-ai-agent-service.ts",
    ],
  },
  {
    id: "owner-intel-tools",
    path: "backend/functions/src/services/ai/ai-tool-run-service.ts",
    purpose: "Business analyst intel tools (morning_brief, plant_health, …)",
    codeHooks: ["frontend/src/features/dashboard/types/river-ai-tools-types.ts"],
  },
];

export function formatRiverAiKnowledgeManifestBlock(): string {
  const lines = RIVER_AI_KNOWLEDGE_SOURCES.map(
    (s) => `- **${s.id}** (\`${s.path}\`): ${s.purpose}`,
  );
  return [
    "## River AI knowledge manifest",
    `Version: ${RIVER_AI_KNOWLEDGE_MANIFEST_VERSION}`,
    "When shipping features, update docs + hooked knowledge files (run audit:river-ai-knowledge).",
    "",
    ...lines,
  ].join("\n");
}
