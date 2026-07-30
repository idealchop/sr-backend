import {
  trainingVideosCollection,
  webinarRegistrationsCollection,
  webinarsCollection,
  eventsTrainingRoot } from "./events-training-collections";

export type WebinarOpsInsights = {
  generatedAt: string;
  totals: {
    guestRegistrations: number;
    memberRegistrations: number;
    guestAttended: number;
    memberAttended: number;
  };
  webinars: {
    eventId: string;
    name: string;
    status: string;
    startsAt: string | null;
    capacity: number | null;
    registrationCount: number;
    acceptedCount: number;
    pendingCount: number;
    declinedCount: number;
    attendedCount: number;
    guestCount: number;
    memberCount: number;
    guestAttendedCount: number;
    memberAttendedCount: number;
  }[];
  recordings: {
    videoId: string;
    name: string;
    category: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    questionCount: number;
  }[];
};

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Ops rollup for webinar registrations + recording engagement (Admin SDK).
 */
export async function getWebinarOpsInsights(): Promise<WebinarOpsInsights> {
  const [eventsSnap, regsSnap, videosSnap, engagementSnap] = await Promise.all([
    webinarsCollection().limit(100).get(),
    webinarRegistrationsCollection().limit(500).get(),
    trainingVideosCollection()
      .where("category", "in", ["webinar", "wrs_stories"])
      .limit(200)
      .get()
      .catch(async () => {
        const [a, b] = await Promise.all([
          trainingVideosCollection().where("category", "==", "webinar").limit(100).get(),
          trainingVideosCollection().where("category", "==", "wrs_stories").limit(100).get(),
        ]);
        return { docs: [...a.docs, ...b.docs] };
      }),
    eventsTrainingRoot()
      .collection("training_video_engagement")
      .limit(200)
      .get()
      .catch(() => ({ docs: [] as Array<{ id: string; data: () => Record<string, unknown> }> })),
  ]);

  const regByEvent = new Map<
    string,
    {
      accepted: number;
      pending: number;
      declined: number;
      attended: number;
      guest: number;
      member: number;
      guestAttended: number;
      memberAttended: number;
    }
  >();
  let guestRegistrations = 0;
  let memberRegistrations = 0;
  let guestAttended = 0;
  let memberAttended = 0;

  for (const doc of regsSnap.docs) {
    const data = doc.data() ?? {};
    const eventId = String(data.eventId || "").trim();
    if (!eventId) continue;
    const bucket = regByEvent.get(eventId) || {
      accepted: 0,
      pending: 0,
      declined: 0,
      attended: 0,
      guest: 0,
      member: 0,
      guestAttended: 0,
      memberAttended: 0,
    };
    const status = String(data.status || "");
    if (status === "accepted") bucket.accepted += 1;
    else if (status === "pending") bucket.pending += 1;
    else if (status === "declined") bucket.declined += 1;

    const kind = String(data.kind || "member") === "guest" ? "guest" : "member";
    const isActive = status === "accepted" || status === "pending";
    if (isActive) {
      if (kind === "guest") {
        bucket.guest += 1;
        guestRegistrations += 1;
      } else {
        bucket.member += 1;
        memberRegistrations += 1;
      }
    }

    if (String(data.attendanceStatus || "") === "attended") {
      bucket.attended += 1;
      if (kind === "guest") {
        bucket.guestAttended += 1;
        guestAttended += 1;
      } else {
        bucket.memberAttended += 1;
        memberAttended += 1;
      }
    }
    regByEvent.set(eventId, bucket);
  }

  const engagementByVideo = new Map<
    string,
    {
      viewCount: number;
      likeCount: number;
      commentCount: number;
      questionCount: number;
    }
  >();
  for (const doc of engagementSnap.docs) {
    const data = doc.data() ?? {};
    engagementByVideo.set(doc.id, {
      viewCount: Number(data.viewCount) || 0,
      likeCount: Number(data.likeCount) || 0,
      commentCount: Number(data.commentCount) || 0,
      questionCount: Number(data.questionCount) || 0,
    });
  }

  const webinars = eventsSnap.docs.map((doc) => {
    const data = doc.data() ?? {};
    const bucket = regByEvent.get(doc.id) || {
      accepted: 0,
      pending: 0,
      declined: 0,
      attended: 0,
      guest: 0,
      member: 0,
      guestAttended: 0,
      memberAttended: 0,
    };
    const capacityRaw =
      data.capacity == null ? null : Number(data.capacity);
    return {
      eventId: doc.id,
      name: String(data.name || "").trim() || "Untitled webinar",
      status: String(data.status || "draft"),
      startsAt: toIso(data.startsAt),
      capacity:
        capacityRaw != null && Number.isFinite(capacityRaw) && capacityRaw > 0 ?
          capacityRaw :
          null,
      registrationCount: Number(data.registrationCount) || 0,
      acceptedCount: bucket.accepted,
      pendingCount: bucket.pending,
      declinedCount: bucket.declined,
      attendedCount: bucket.attended,
      guestCount: bucket.guest,
      memberCount: bucket.member,
      guestAttendedCount: bucket.guestAttended,
      memberAttendedCount: bucket.memberAttended,
    };
  });

  const recordings = videosSnap.docs
    .map((doc) => {
      const data = doc.data() ?? {};
      const status = String(data.status || "");
      if (status !== "published" && status !== "archived") return null;
      const eng = engagementByVideo.get(doc.id) || {
        viewCount: 0,
        likeCount: 0,
        commentCount: 0,
        questionCount: 0,
      };
      return {
        videoId: doc.id,
        name: String(data.name || "").trim() || "Untitled recording",
        category: String(data.category || ""),
        viewCount: eng.viewCount,
        likeCount: eng.likeCount,
        commentCount: eng.commentCount,
        questionCount: eng.questionCount,
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      guestRegistrations,
      memberRegistrations,
      guestAttended,
      memberAttended,
    },
    webinars,
    recordings,
  };
}
