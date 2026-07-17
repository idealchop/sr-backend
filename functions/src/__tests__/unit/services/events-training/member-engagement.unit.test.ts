import { beforeEach, describe, expect, it, vi } from "vitest";

const videoGet = vi.fn();
const userGet = vi.fn();
const likeGet = vi.fn();
const summaryGet = vi.fn();
const postsGet = vi.fn();
const postGet = vi.fn();
const postSet = vi.fn();
const runTransaction = vi.fn();

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: (name: string) => {
      if (name === "users") {
        return {
          doc: () => ({
            get: userGet,
          }),
        };
      }
      return {};
    },
    runTransaction: (...args: unknown[]) => runTransaction(...args),
  },
  FieldValue: {
    serverTimestamp: () => "SERVER_TS",
  },
}));

vi.mock(
  "../../../../services/events-training/events-training-collections",
  () => ({
    EVENTS_TRAINING_COLLECTIONS: {
      trainingVideoEngagement: "training_video_engagement",
    },
    eventsTrainingRoot: () => ({
      collection: () => ({
        doc: (videoId: string) => ({
          get: summaryGet,
          collection: (sub: string) => {
            if (sub === "likes") {
              return {
                doc: () => ({ get: likeGet }),
              };
            }
            if (sub === "notes") {
              return {
                doc: () => ({
                  get: async () => ({
                    exists: true,
                    data: () => ({ body: "My takeaways", updatedAt: null }),
                  }),
                  set: vi.fn(),
                  delete: vi.fn(),
                }),
              };
            }
            if (sub === "views") {
              return {
                doc: () => ({
                  get: async () => ({
                    exists: true,
                    data: () => ({ watchedAt: null, createdAt: null }),
                  }),
                }),
              };
            }
            if (sub === "posts") {
              return {
                orderBy: () => ({
                  limit: () => ({ get: postsGet }),
                }),
                doc: (postId?: string) => ({
                  id: postId || "post-1",
                  get: postGet,
                  set: postSet,
                }),
              };
            }
            return {};
          },
          id: videoId,
        }),
      }),
    }),
    trainingVideosCollection: () => ({
      doc: () => ({ get: videoGet }),
    }),
  }),
);

vi.mock("../../../../services/team/team-chat-profanity-filter", () => ({
  maskProfanityLocal: (text: string) =>
    text.replace(/fuck/gi, "****").replace(/puta/gi, "****"),
  maskVideoEngagementProfanity: async (text: string) =>
    text.replace(/fuck/gi, "****").replace(/puta/gi, "****"),
}));

import {
  answerVideoPost,
  createVideoPost,
  getVideoEngagement,
  saveVideoNote,
} from "../../../../services/events-training/member-engagement-service";

describe("member-engagement-service", () => {
  beforeEach(() => {
    videoGet.mockReset();
    userGet.mockReset();
    likeGet.mockReset();
    summaryGet.mockReset();
    postsGet.mockReset();
    postGet.mockReset();
    postSet.mockReset();
    runTransaction.mockReset();

    videoGet.mockResolvedValue({
      exists: true,
      data: () => ({ category: "webinar", status: "published" }),
    });
    userGet.mockResolvedValue({
      exists: true,
      data: () => ({ displayName: "Ana Owner" }),
    });
    likeGet.mockResolvedValue({ exists: false });
    summaryGet.mockResolvedValue({
      exists: true,
      data: () => ({ likeCount: 2, commentCount: 1, questionCount: 0 }),
    });
    postsGet.mockResolvedValue({
      docs: [
        {
          id: "c1",
          data: () => ({
            kind: "comment",
            body: "Great session",
            userId: "u1",
            businessId: "b1",
            displayName: "Ana",
            status: "visible",
            answer: null,
            createdAt: null,
          }),
        },
      ],
    });
    postGet.mockResolvedValue({
      exists: true,
      data: () => ({
        kind: "question",
        body: "How do I upgrade?",
        userId: "u1",
        businessId: "b1",
        displayName: "Ana",
        status: "visible",
        answer: null,
        createdAt: null,
      }),
    });
    postSet.mockResolvedValue(undefined);
  });

  it("loads engagement summary without posts payload", async () => {
    const data = await getVideoEngagement({ videoId: "vid-1", userId: "me" });
    expect(data.likeCount).toBe(2);
    expect(data.commentCount).toBe(1);
    expect(data.likedByMe).toBe(false);
    expect(data.myNote).toBe("My takeaways");
    expect(data.watched).toBe(true);
  });

  it("rejects short posts", async () => {
    await expect(
      createVideoPost({
        videoId: "vid-1",
        userId: "me",
        businessId: "biz",
        kind: "comment",
        body: "x",
      }),
    ).rejects.toThrow(/bit more/i);
  });

  it("creates a comment when body is valid", async () => {
    runTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({
          data: () => ({ likeCount: 0, commentCount: 0, questionCount: 0 }),
        }),
        set: vi.fn(),
      });
    });

    const post = await createVideoPost({
      videoId: "vid-1",
      userId: "me",
      businessId: "biz",
      kind: "comment",
      body: "Thanks for this webinar",
    });

    expect(post.kind).toBe("comment");
    expect(post.displayName).toBe("Ana Owner");
    expect(post.body).toBe("Thanks for this webinar");
    expect(runTransaction).toHaveBeenCalled();
  });

  it("masks profanity when creating a comment", async () => {
    runTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({
          data: () => ({ likeCount: 0, commentCount: 0, questionCount: 0 }),
        }),
        set: vi.fn(),
      });
    });

    const post = await createVideoPost({
      videoId: "vid-1",
      userId: "me",
      businessId: "biz",
      kind: "comment",
      body: "This is fucking amazing",
    });

    expect(post.body.toLowerCase()).not.toContain("fuck");
    expect(post.body).toContain("****");
  });

  it("masks profanity on ops answers", async () => {
    const post = await answerVideoPost({
      videoId: "vid-1",
      postId: "q1",
      answer: "Don't be puta about the upgrade path",
      answeredByUid: "ops-1",
    });

    expect(post.answer?.toLowerCase()).not.toContain("puta");
    expect(postSet).toHaveBeenCalled();
  });

  it("saves a private note", async () => {
    const result = await saveVideoNote({
      videoId: "vid-1",
      userId: "me",
      businessId: "biz",
      body: "  Follow up with rider incentives  ",
    });
    expect(result.body).toBe("Follow up with rider incentives");
  });
});
