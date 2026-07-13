import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { SupportKnowledgeEntry } from "./support-knowledge-types";

const SMARTREFILL_APP_ID = "smartrefill";
const TRAINING_VIDEOS = "training_videos";
const TUTORIAL_CATEGORY = "tutorial";
const MAX_TUTORIALS = 40;

export type PublishedTutorialKnowledge = {
  id: string;
  name: string;
  description: string;
  appPages: string[];
};

function mapPublishedTutorial(
  id: string,
  data: Record<string, unknown>,
): PublishedTutorialKnowledge | null {
  const category = typeof data.category === "string" ? data.category : "";
  if (category !== TUTORIAL_CATEGORY) return null;

  const status = typeof data.status === "string" ? data.status : "";
  if (status !== "published") return null;

  const appId = typeof data.appId === "string" ? data.appId.trim() : "";
  if (appId && appId.toLowerCase() !== SMARTREFILL_APP_ID) return null;

  const name =
    (typeof data.name === "string" && data.name.trim()) ||
    (typeof data.title === "string" && data.title.trim()) ||
    "";
  if (!name) return null;

  const description =
    (typeof data.description === "string" && data.description.trim()) ||
    (typeof data.summary === "string" && data.summary.trim()) ||
    "";

  const appPages = Array.isArray(data.appPages) ?
    data.appPages
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .map((p) => p.trim()) :
    [];

  return { id, name, description, appPages };
}

/**
 * Loads published SmartRefill tutorial videos for River AI Buddy knowledge.
 */
export async function listPublishedSmartrefillTutorials(): Promise<
  PublishedTutorialKnowledge[]
  > {
  try {
    const snap = await db
      .collection("apps")
      .doc(SMARTREFILL_APP_ID)
      .collection(TRAINING_VIDEOS)
      .where("category", "==", TUTORIAL_CATEGORY)
      .where("status", "==", "published")
      .limit(MAX_TUTORIALS)
      .get();

    const videos: PublishedTutorialKnowledge[] = [];
    for (const doc of snap.docs) {
      const mapped = mapPublishedTutorial(doc.id, doc.data() ?? {});
      if (mapped) videos.push(mapped);
    }

    return videos.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    logger.warn("listPublishedSmartrefillTutorials failed", { error });
    return [];
  }
}

/** FAQ-style entries so token scoring can match how-to questions to videos. */
export function tutorialVideosToKnowledgeEntries(
  videos: PublishedTutorialKnowledge[],
): SupportKnowledgeEntry[] {
  return videos.map((video) => {
    const pages =
      video.appPages.length > 0 ? video.appPages.join(", ") : "general";
    const desc = video.description || "In-app how-to video.";
    return {
      id: `tutorial-video-${video.id}`,
      topic: `Video tutorial: ${video.name}`,
      content:
        `${desc} Related screens: ${pages}. ` +
        "Tell the owner to open **Tutorial videos** (sidebar or mobile button), " +
        `or go to /dashboard?tutorial=${video.id} to play this video while they work.`,
    };
  });
}

/**
 * Always-on catalog block so Buddy can cite current published tutorial titles.
 */
export function formatTutorialVideosCatalogBlock(
  videos: PublishedTutorialKnowledge[],
): string {
  const lines = [
    "## In-app video tutorials (live catalog)",
    "When the owner's question matches a published tutorial, **recommend it by title**.",
    "Tell them how to open it:",
    "- Desktop: left sidebar → **Tutorial videos**",
    "- Mobile: floating **Tutorial** button",
    "- Direct: `/dashboard?tutorial={videoId}` (opens that video in the follow-along player)",
    "Videos keep playing in a small coach player while they navigate the app.",
    "",
  ];

  if (videos.length === 0) {
    lines.push(
      "No published tutorials in the catalog right now. Still explain the Tutorial videos panel;",
      "new videos appear after Smart Refill publishes them.",
    );
    return lines.join("\n");
  }

  lines.push("### Published tutorials");
  for (const video of videos) {
    const pages =
      video.appPages.length > 0 ? ` · pages: ${video.appPages.join(", ")}` : "";
    const desc = video.description ? ` — ${video.description}` : "";
    lines.push(
      `- **${video.name}** (id \`${video.id}\`)${pages}${desc}`,
    );
  }
  return lines.join("\n");
}

/** Exported for unit tests. */
export function mapPublishedTutorialForTest(
  id: string,
  data: Record<string, unknown>,
): PublishedTutorialKnowledge | null {
  return mapPublishedTutorial(id, data);
}
