import { app } from "./index";
import { readMetaPageAccessToken } from "./services/meta/meta-messenger-send-service";

const PORT = process.env.PORT || 8070;

app.listen(PORT, () => {
  console.log(`🚀 Local Backend Server running on http://localhost:${PORT}`);
  console.log("📡 Connecting to live Firestore database...");
  if (!readMetaPageAccessToken()) {
    console.warn(
      "⚠️  META_COMMUNITY_PAGE_ACCESS_TOKEN is not set — WRS accept will not notify customers in Messenger.",
    );
    console.warn(
      "   Add it to functions/.secret.local (see .secret.local.example) or use production NEXT_PUBLIC_BFF_URL.",
    );
  }
});
