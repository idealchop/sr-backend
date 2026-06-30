/**
 * Local preview for community Messenger templates and parsing.
 *
 * Usage (from backend/functions):
 *   npm run community:messenger:preview
 *   npm run community:messenger:preview -- --parse path/to/order.txt
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCommunityOrderTemplate } from "../services/meta/community-dispatch-template-parser";
import {
  COMMUNITY_DELIVERY_LOCATION_TIP,
  COMMUNITY_ORDER_TEMPLATE_BLOCK,
  buildCommunityOrderFormMessage,
  buildCommunityWelcomeMessage,
} from "../services/meta/community-order-template";

const SAMPLE_ORDER = `Name: Justfer (Testing)
Quantity: 10
Water Station:
Water: alkaline
Address: Alabang, Muntinlupa City
Email: justfer15@gmail.com
Phone Number: 09773907598`;

function readParseInput(argv: string[]): string {
  const parseFlagIndex = argv.indexOf("--parse");
  if (parseFlagIndex === -1) return SAMPLE_ORDER;

  const fileArg = argv[parseFlagIndex + 1];
  if (!fileArg || fileArg.startsWith("-")) {
    throw new Error("Usage: npm run community:messenger:preview -- --parse <file.txt>");
  }

  return readFileSync(resolve(fileArg), "utf8");
}

function printSection(title: string, body: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(title);
  console.log("=".repeat(60));
  console.log(body);
}

function main(): void {
  const welcome = buildCommunityWelcomeMessage();
  const form = buildCommunityOrderFormMessage();
  const parseInput = readParseInput(process.argv.slice(2));
  const parsed = parseCommunityOrderTemplate(parseInput);

  printSection("Message 1 — Welcome (greeting + delivery tip)", welcome);
  printSection("Message 2 — Order form", form);

  console.log("\nChecks:");
  console.log(`  • Delivery tip in welcome: ${welcome.includes(COMMUNITY_DELIVERY_LOCATION_TIP) ? "yes" : "NO"}`);
  console.log(`  • Delivery tip in form: ${form.includes(COMMUNITY_DELIVERY_LOCATION_TIP) ? "NO (unexpected)" : "no (ok)"}`);
  console.log(`  • delivery: line in form block: ${COMMUNITY_ORDER_TEMPLATE_BLOCK.includes("delivery:") ? "YES (unexpected)" : "no (ok)"}`);

  printSection("Parse result", JSON.stringify(parsed, null, 2));

  if (!parsed.ok) {
    console.error("\nParse failed — missing:", parsed.errors.join(", "));
    process.exitCode = 1;
    return;
  }

  if (parsed.fields.delivery !== true) {
    console.error("\nExpected delivery=true by default, got:", parsed.fields.delivery);
    process.exitCode = 1;
  }
}

main();
