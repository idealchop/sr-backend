import { Request, Response, NextFunction } from "express";
import { logger } from "firebase-functions";
import { auth } from "../config/firebase-admin";
import { scheduleApiSessionAccessRecord } from "../services/auth/session-activity-service";

export const validateFirebaseIdToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer ")
  ) {
    res.status(401).send("Unauthorized");
    return;
  }

  const idToken = req.headers.authorization.split("Bearer ")[1];

  // Bypass for local BDD testing if in emulator
  if (process.env.FUNCTIONS_EMULATOR) {
    if (idToken === "MOCK_TOKEN") {
      (req as any).user = {
        uid: "user123",
        email: "test@test.com",
        name: "BDD Tester",
      };
      return next();
    }
    if (idToken === "MOCK_TOKEN_SIGNUP") {
      (req as any).user = {
        uid: "bdd_signup_user",
        email: "signup-bdd@test.com",
        name: "BDD Signup User",
      };
      return next();
    }
  }

  try {
    const decodedIdToken = await auth.verifyIdToken(idToken);
    (req as any).user = decodedIdToken;
    scheduleApiSessionAccessRecord(decodedIdToken, req);
    next();
  } catch (error) {
    logger.warn("verifyIdToken failed", { path: req.path, error });
    res.status(401).send("Unauthorized");
  }
};
