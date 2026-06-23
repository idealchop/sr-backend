import { db, FieldValue } from "../../config/firebase-admin";
import type { WhatsNewReleaseInput } from "./whats-new-types";
import {
  WHATS_NEW_APP_DOC_ID,
  WHATS_NEW_SUBCOLLECTION,
} from "./whats-new-types";

const BATCH_LIMIT = 450;

export async function syncWhatsNewReleases(
  releases: WhatsNewReleaseInput[],
): Promise<{ written: number; appId: string }> {
  if (releases.length === 0) {
    return { written: 0, appId: WHATS_NEW_APP_DOC_ID };
  }

  const sorted = [...releases].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );

  let written = 0;
  for (let offset = 0; offset < sorted.length; offset += BATCH_LIMIT) {
    const chunk = sorted.slice(offset, offset + BATCH_LIMIT);
    const batch = db.batch();
    const syncedAt = FieldValue.serverTimestamp();

    for (const release of chunk) {
      const ref = db
        .collection("apps")
        .doc(WHATS_NEW_APP_DOC_ID)
        .collection(WHATS_NEW_SUBCOLLECTION)
        .doc(release.id);
      batch.set(
        ref,
        {
          id: release.id,
          publishedAt: release.publishedAt,
          title: release.title,
          summary: release.summary,
          items: release.items,
          syncedAt,
          updatedAt: syncedAt,
        },
        { merge: true },
      );
      written += 1;
    }

    await batch.commit();
  }

  await db.collection("apps").doc(WHATS_NEW_APP_DOC_ID).set(
    {
      appSlug: WHATS_NEW_APP_DOC_ID,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { written, appId: WHATS_NEW_APP_DOC_ID };
}
