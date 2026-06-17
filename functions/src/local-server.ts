import { app } from "./index";

const PORT = process.env.PORT || 8070;

app.listen(PORT, () => {
  console.log(`🚀 Local Backend Server running on http://localhost:${PORT}`);
  console.log("📡 Connecting to live Firestore database...");
});
