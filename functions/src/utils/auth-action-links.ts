// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * Rewrites Firebase Auth action URLs (firebaseapp.com/__/auth/action) to our app origin
 * so users land on branded pages instead of Firebase's default handler UI.
 */
export function toAppAuthActionLink(
  firebaseActionLink: string,
  appPath: string,
  baseUrl: string,
): string {
  try {
    const parsed = new URL(firebaseActionLink.trim());
    const oobCode = parsed.searchParams.get("oobCode");
    const mode = parsed.searchParams.get("mode");
    const apiKey = parsed.searchParams.get("apiKey");
    const lang = parsed.searchParams.get("lang");

    if (!oobCode || !mode) {
      return firebaseActionLink;
    }

    const app = new URL(
      appPath.startsWith("/") ? appPath : `/${appPath}`,
      baseUrl,
    );
    app.searchParams.set("oobCode", oobCode);
    app.searchParams.set("mode", mode);
    if (apiKey) app.searchParams.set("apiKey", apiKey);
    if (lang) app.searchParams.set("lang", lang);
    return app.toString();
  } catch {
    return firebaseActionLink;
  }
}
