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
  buildCommunityOrderFormExampleMessage,
  buildCommunityOrderFormMessage,
  buildCommunityWaterDeliveryIntroMessage,
  buildCommunityWelcomeGreeting,
  buildCommunityWelcomeMessage,
} from "../services/meta/community-order-template";

const SAMPLE_ORDER = `Name: John Doe
Address: 12 Jasmine St, Brgy. San Roque, Antipolo City
Email: john@example.com
Number: 09171234567
Order: 3 slim - alkaline, 4 round - purified`;

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
  const welcomeNew = buildCommunityWelcomeMessage({ isReturningUser: false });
  const welcomeReturning = buildCommunityWelcomeMessage({ isReturningUser: true });
  const intro = buildCommunityWaterDeliveryIntroMessage();
  const form = buildCommunityOrderFormMessage();
  const example = buildCommunityOrderFormExampleMessage();
  const parseInput = readParseInput(process.argv.slice(2));
  const parsed = parseCommunityOrderTemplate(parseInput);

  printSection("Greeting — New user (PSID)", buildCommunityWelcomeGreeting({ isReturningUser: false }));
  printSection("Greeting — Returning user (PSID)", buildCommunityWelcomeGreeting({ isReturningUser: true }));
  printSection("Message 1 — Welcome new (full)", welcomeNew);
  printSection("Message 1 — Welcome returning (full)", welcomeReturning);
  printSection("Message 2 — Service choice", "What can we help you with today?\n[Water Delivery] [Inquiry / Others]");
  printSection("Message 3 — Water delivery intro", intro);
  printSection("Message 4 — Order form", form);
  printSection("Message 5 — Example + tips", example);

  console.log("\nChecks:");
  console.log(`  • Delivery tip in welcome: ${welcomeNew.includes(COMMUNITY_DELIVERY_LOCATION_TIP) ? "YES (unexpected)" : "no (ok)"}`);
  console.log(`  • Delivery tip in example: ${example.includes(COMMUNITY_DELIVERY_LOCATION_TIP) ? "yes (ok)" : "no (unexpected)"}`);
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
