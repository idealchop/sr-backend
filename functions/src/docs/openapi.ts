/**
 * Frontend read-model hints (see smartrefill-v3/docs/hybrid-read-model.md).
 * Documented on GET operations as extension x-frontend-read-model.
 */
export type FrontendReadModel =
  | "firestore-primary"
  | "api-fallback"
  | "api-primary"
  | "api-only"
  | "hybrid-gated";

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "SmartRefill V3 API Reference",
    version: "3.0.5",
    description:
      "Lean API Gateway for SmartRefill V3 mutations, heavy processing, and secure reads. " +
      "The dashboard uses Firestore live snapshots for customers, transactions, and pending " +
      "submissions; list GETs below remain for Postman, integrations, and fallback reconcile. " +
      "Live rider tracking: POST rider GPS, public track order lookup, shared route tracker. " +
      "See x-frontend-read-model on each GET and smartrefill-v3/docs/hybrid-read-model.md.",
    contact: {
      name: "SmartRefill Support",
      email: "support@smartrefill.io",
    },
  },
  servers: [
    {
      url: "http://localhost:5001/smartrefill-v3/us-central1/smartrefillV3Api",
      description: "Local Firebase Emulator",
    },
    {
      url: "https://us-central1-smartrefill-v3.cloudfunctions.net/smartrefillV3Api",
      description: "Production Environment",
    },
  ],
  security: [
    {
      bearerAuth: [],
    },
  ],
  tags: [
    {
      name: "Auth",
      description: "Firebase Authentication state, signup, " +
        "staff onboarding & user profiles",
    },
    {
      name: "Business",
      description: "Business administration, configurations, " +
        "and tenant scoping",
    },
    {
      name: "Customers",
      description: "Customer accounts, outstanding balances, " +
        "stats, and sharing links",
    },
    {
      name: "Transactions",
      description: "Refill sales, payments, deposits, " +
        "ledger updates, and audits",
    },
    {
      name: "Deliveries",
      description: "Route sheets, rider assignments, " +
        "completions, and sharing routes",
    },
    {
      name: "Riders",
      description: "Delivery personnel and performance metrics",
    },
    {
      name: "Inventory",
      description: "Station product catalog and stock (hybrid-gated on dashboard)",
    },
    {
      name: "Submissions",
      description: "Customer portal raw submissions (triage)",
    },
    {
      name: "Notifications",
      description: "In-app notification feed",
    },
    {
      name: "EventsTraining",
      description:
        "Sales Portal ops: tutorial/webinar publish → owner notify fan-out",
    },
    {
      name: "Subscriptions",
      description: "Plans, billing status, and add-ons",
    },
    {
      name: "Public",
      description: "Customer portal, track order, and shared route (no Firebase auth)",
    },
    {
      name: "Community",
      description: "River community Facebook Page Messenger dispatch (CP-01…CP-27)",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT (Firebase ID Token)",
      },
    },
    parameters: {
      businessId: {
        name: "businessId",
        in: "path",
        required: true,
        description: "The unique ID of the Business Tenant",
        schema: { type: "string" },
      },
      customerId: {
        name: "customerId",
        in: "path",
        required: true,
        description: "The unique ID of the Customer",
        schema: { type: "string" },
      },
      transactionId: {
        name: "id",
        in: "path",
        required: true,
        description: "The unique ID of the Transaction",
        schema: { type: "string" },
      },
      riderId: {
        name: "id",
        in: "path",
        required: true,
        description: "The unique ID of the Rider",
        schema: { type: "string" },
      },
      deliveryId: {
        name: "id",
        in: "path",
        required: true,
        description: "The unique ID of the Delivery route",
        schema: { type: "string" },
      },
    },
    schemas: {
      Business: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          ownerUid: { type: "string" },
          onboardingProgress: { type: "object" },
          uiConfig: { type: "object" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Customer: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          phone: { type: "string" },
          address: { type: "string" },
          unpaidBalance: { type: "number" },
          totalSales: { type: "number" },
          notes: { type: "string" },
          lastFulfilledAt: {
            type: "string",
            format: "date-time",
            description:
              "Denormalized latest fulfilled order timestamp " +
              "(delivery, collection, walk-in, direct sale).",
          },
          lastFulfilledType: {
            type: "string",
            enum: ["delivery", "collection", "walkin", "direct_sale"],
          },
          lastOrderAt: {
            type: "string",
            format: "date-time",
            description: "Legacy mirror of lastFulfilledAt for older clients.",
          },
          healthScore: {
            type: "number",
            minimum: 0,
            maximum: 100,
            description:
              "Denormalized 0–100 suki health score (API write-path + nightly backfill).",
          },
          healthScoreUpdatedAt: {
            type: "string",
            format: "date-time",
            description: "When healthScore was last recomputed.",
          },
        },
      },
      Transaction: {
        type: "object",
        properties: {
          id: { type: "string" },
          customerId: { type: "string" },
          customerName: { type: "string" },
          type: { type: "string", enum: ["sale", "payment", "deposit", "withdrawal"] },
          waterRefills: { type: "number" },
          amount: { type: "number" },
          paymentAmount: { type: "number" },
          balanceDue: { type: "number" },
          status: { type: "string", enum: ["pending", "completed", "cancelled"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Delivery: {
        type: "object",
        properties: {
          id: { type: "string" },
          riderId: { type: "string" },
          riderName: { type: "string" },
          transactionIds: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["assigned", "completed", "cancelled"] },
          routeDetails: { type: "object" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Rider: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          phone: { type: "string" },
          userId: { type: "string", description: "Linked Firebase Auth UID" },
          status: { type: "string", enum: ["active", "inactive"] },
          lastLocation: { $ref: "#/components/schemas/RiderLastLocation" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      RiderLastLocation: {
        type: "object",
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
          accuracy: { type: "number" },
          heading: { type: "number" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      PortalTrackOrder: {
        type: "object",
        description:
          "Customer-facing track order payload. Map shows rider + this order's destination only.",
        properties: {
          type: { type: "string", enum: ["transaction", "submission"] },
          id: { type: "string" },
          referenceId: { type: "string" },
          status: { type: "string" },
          riderName: { type: "string" },
          riderPhotoUrl: { type: "string" },
          riderPhone: { type: "string" },
          riderAvgRating: {
            type: "number",
            nullable: true,
            description: "Average customer star rating for this rider (1–5)",
          },
          riderLocation: { $ref: "#/components/schemas/RiderLastLocation" },
          destination: {
            type: "object",
            properties: {
              latitude: { type: "number" },
              longitude: { type: "number" },
              address: { type: "string" },
            },
          },
          riderOtherActiveStops: {
            type: "integer",
            description:
              "Count of other pending/placed/in-transit stops " +
              "for the same rider (excludes this order)",
          },
          arrivedAt: { type: "string", format: "date-time", nullable: true },
          deliveredAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      PortalTrackSearchRow: {
        type: "object",
        description:
          "Open order row for track lookup (ledger transaction or pending submission).",
        properties: {
          transactionId: { type: "string" },
          referenceId: { type: "string" },
          type: { type: "string" },
          typeLabel: { type: "string" },
          refillLabel: { type: "string", nullable: true },
          assetLabel: {
            type: "string",
            description: "D = dispatch, C = collect, D&C = both",
          },
          scheduledAt: { type: "string", format: "date-time", nullable: true },
          status: { type: "string" },
          customerName: { type: "string" },
          source: {
            type: "string",
            enum: ["transaction", "submission"],
            description:
              "submission = pending_review raw_submission; transaction = ledger order",
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Auth"],
        summary: "API Health Check",
        description: "Checks if the Express Gateway is up and detects emulator status.",
        security: [],
        responses: {
          200: {
            description: "Gateway is operational.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    emulator: { type: "boolean", example: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/auth/signup": {
      post: {
        tags: ["Auth"],
        summary: "Sign Up / Register Client Access",
        description: "Registers the authenticated Firebase user into the local database.",
        responses: {
          200: { description: "User record successfully initialized." },
          401: { description: "Missing or invalid authorization header." },
        },
      },
    },
    "/auth/status": {
      get: {
        "tags": ["Auth"],
        "summary": "Verify Active Auth Session",
        "description": "Decodes the Firebase token and returns user details.",
        "x-frontend-read-model": "api-only",
        "responses": {
          200: { description: "Active session and claim details returned." },
        },
      },
    },
    "/business": {
      get: {
        tags: ["Business"],
        summary: "List Business Tenants",
        description: "Retrieves all business profiles owned or managed by the authenticated user.",
        responses: {
          200: {
            description: "List of business profiles.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Business" },
                },
              },
            },
          },
        },
      },
    },
    "/business/create": {
      post: {
        tags: ["Business"],
        summary: "Create a New Business Tenant",
        description: "Provisions a new business, creating standard collections and initial state.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", example: "Downtown Refill Hub" },
                  address: { type: "string", example: "123 Main St" },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Business tenant successfully created.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Business" },
              },
            },
          },
        },
      },
    },
    "/business/{businessId}": {
      get: {
        tags: ["Business"],
        summary: "Get Business Details",
        parameters: [{ $ref: "#/components/parameters/businessId" }],
        responses: {
          200: {
            description: "Business metadata profile.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Business" },
              },
            },
          },
        },
      },
      put: {
        tags: ["Business"],
        summary: "Update Business Profile",
        parameters: [{ $ref: "#/components/parameters/businessId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  address: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Business profile successfully updated." },
        },
      },
    },
    "/business/{businessId}/platform-feedback": {
      post: {
        tags: ["Business"],
        summary: "Submit platform product feedback",
        description:
          "Writes a document to root collection apps_feedback (appId smartrefill) " +
          "and merges businesses/{businessId}.userFeedback. Client SDK cannot read apps_feedback.",
        parameters: [{ $ref: "#/components/parameters/businessId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["rating"],
                properties: {
                  appId: {
                    type: "string",
                    example: "smartrefill",
                    description: "Product id; smartrefill-v3 is normalized to smartrefill",
                  },
                  source: {
                    type: "string",
                    example: "dashboard-profile-popover",
                  },
                  rating: { type: "integer", minimum: 1, maximum: 5 },
                  feedback: { type: "string" },
                  recommend: { type: "boolean", nullable: true },
                  nextUpdateSuggestion: { type: "string" },
                  plan: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Feedback recorded; acknowledgement status pending." },
          400: { description: "Invalid rating (must be 1–5)." },
        },
      },
    },
    "/business/{businessId}/platform-feedback/me": {
      get: {
        "tags": ["Business"],
        "summary": "Get latest platform feedback for current user",
        "description":
          "Returns the most recent apps_feedback row for this business and authenticated user.",
        "x-frontend-read-model": "api-only",
        "parameters": [
          { $ref: "#/components/parameters/businessId" },
          {
            name: "appId",
            in: "query",
            required: false,
            schema: { type: "string", example: "smartrefill" },
          },
        ],
        "responses": {
          200: {
            description: "Latest feedback record or null.",
          },
        },
      },
    },
    "/business/{businessId}/customers": {
      get: {
        "tags": ["Customers"],
        "summary": "List Customers",
        "description":
          "Returns all customers for the tenant. Dashboard reads Firestore; " +
          "use this GET for Postman, exports, and API reconcile fallback.",
        "x-frontend-read-model": "firestore-primary",
        "parameters": [{ $ref: "#/components/parameters/businessId" }],
        "responses": {
          200: {
            description: "Array of customer entities.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Customer" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Customers"],
        summary: "Create Customer Profile",
        parameters: [{ $ref: "#/components/parameters/businessId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "phone"],
                properties: {
                  name: { type: "string", example: "Alice Johnson" },
                  phone: { type: "string", example: "+15550199" },
                  address: { type: "string", example: "Suite 4B" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Customer created.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Customer" },
              },
            },
          },
        },
      },
    },
    "/business/{businessId}/customers/{customerId}/stats": {
      get: {
        "tags": ["Customers"],
        "summary": "Single Customer Statistics",
        "description": "Aggregated stats for one customer (profile dialog).",
        "x-frontend-read-model": "api-only",
        "parameters": [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/customerId" },
        ],
        "responses": {
          200: { description: "Customer profile stats returned." },
        },
      },
    },
    "/business/{businessId}/customers/stats": {
      get: {
        "tags": ["Customers"],
        "summary": "Customer Aggregate Statistics",
        "x-frontend-read-model": "api-only",
        "parameters": [{ $ref: "#/components/parameters/businessId" }],
        "responses": {
          200: { description: "Analytics of active, balance-due, and total customers." },
        },
      },
    },
    "/business/{businessId}/customers/{customerId}": {
      get: {
        "tags": ["Customers"],
        "summary": "Get Customer Profile",
        "description":
          "Single customer record. Dashboard uses Firestore; " +
          "GET used for cold-start fallback (e.g. statement print).",
        "x-frontend-read-model": "api-fallback",
        "parameters": [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/customerId" },
        ],
        "responses": {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Customer" },
              },
            },
          },
        },
      },
      patch: {
        tags: ["Customers"],
        summary: "Update Customer Details",
        parameters: [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/customerId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  phone: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Customer updated." },
        },
      },
      delete: {
        tags: ["Customers"],
        summary: "Delete Customer",
        parameters: [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/customerId" },
        ],
        responses: {
          200: { description: "Customer soft/hard deleted." },
        },
      },
    },
    "/business/{businessId}/transactions": {
      get: {
        "tags": ["Transactions"],
        "summary": "List Transactions Ledger",
        "description":
          "Lists ledger entries. Optional query customerId filters by customer. " +
          "Dashboard reads Firestore; use for Postman, integrations, and reconcile fallback.",
        "x-frontend-read-model": "firestore-primary",
        "parameters": [
          { $ref: "#/components/parameters/businessId" },
          {
            name: "customerId",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Filter transactions for one customer",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", maximum: 10000 },
            description: "Max rows (exports / reconcile)",
          },
        ],
        "responses": {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Transaction" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Transactions"],
        summary: "Record Ledger Mutation",
        description:
          "Processes water sale refills, cash payments, container deposits, or balance updates.",
        parameters: [{ $ref: "#/components/parameters/businessId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["customerId", "type", "amount"],
                properties: {
                  customerId: { type: "string" },
                  type: { type: "string", enum: ["sale", "payment", "deposit"] },
                  amount: { type: "number" },
                  waterRefills: { type: "number" },
                  paymentAmount: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Transaction" },
              },
            },
          },
        },
      },
    },
    "/business/{businessId}/transactions/{id}/history": {
      get: {
        "tags": ["Transactions"],
        "summary": "Transaction Audit History",
        "description": "Immutable audit log for a transaction (ledger detail panel).",
        "x-frontend-read-model": "api-only",
        "parameters": [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/transactionId" },
        ],
        "responses": {
          200: { description: "Audit log entries." },
        },
      },
    },
    "/business/{businessId}/transactions/{id}": {
      get: {
        "tags": ["Transactions"],
        "summary": "Get Transaction Detail",
        "description":
          "Single transaction. Dashboard resolves from Firestore; " +
          "GET used when linked row missing from snapshot.",
        "x-frontend-read-model": "api-fallback",
        "parameters": [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/transactionId" },
        ],
        "responses": {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Transaction" },
              },
            },
          },
        },
      },
      patch: {
        tags: ["Transactions"],
        summary: "Amend Transaction Data",
        description:
          "Updates delivery status, payments, line items, etc. Server sets `arrivedAt` when " +
          "status first becomes `in-transit`, and `deliveredAt` when first " +
          "`delivered`/`collected`/`completed`.",
        parameters: [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/transactionId" },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  deliveryStatus: {
                    type: "string",
                    enum: [
                      "pending",
                      "placed",
                      "in-transit",
                      "delivered",
                      "collected",
                      "failed",
                      "cancelled",
                      "completed",
                    ],
                  },
                  riderId: { type: "string" },
                  notes: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Transaction updated and ledger adjusted." },
        },
      },
    },
    "/inventory/{businessId}": {
      get: {
        "tags": ["Inventory"],
        "summary": "List Inventory Items",
        "description":
          "Station product catalog. Dashboard: one gated load via " +
          "InventoryProvider (shared across page and dialogs).",
        "x-frontend-read-model": "hybrid-gated",
        "parameters": [{ $ref: "#/components/parameters/businessId" }],
        "responses": {
          200: {
            description: "Inventory items array.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Inventory"],
        summary: "Create Inventory Item",
        parameters: [{ $ref: "#/components/parameters/businessId" }],
        responses: {
          200: { description: "Item created." },
        },
      },
    },
    "/business/{businessId}/raw-submissions/pending": {
      get: {
        "tags": ["Submissions"],
        "summary": "List Pending Portal Submissions",
        "description":
          "Pending_review queue. Dashboard reads Firestore; " +
          "GET for Postman and integrations.",
        "x-frontend-read-model": "firestore-primary",
        "parameters": [{ $ref: "#/components/parameters/businessId" }],
        "responses": {
          200: { description: "Pending raw submissions." },
        },
      },
    },
    "/business/{businessId}/raw-submissions/{submissionId}": {
      get: {
        "tags": ["Submissions"],
        "summary": "Get Submission Detail (Triage)",
        "description": "Submission payload, linked customer, and candidate matches for triage.",
        "x-frontend-read-model": "api-only",
        "parameters": [
          { $ref: "#/components/parameters/businessId" },
          {
            name: "submissionId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        "responses": {
          200: { description: "Triage detail returned." },
        },
      },
    },
    "/notifications": {
      get: {
        "tags": ["Notifications"],
        "summary": "List Notifications",
        "description": "In-app feed; dashboard polls ~60s with jitter.",
        "x-frontend-read-model": "api-primary",
        "parameters": [
          {
            name: "businessId",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        "responses": {
          200: { description: "Notification list." },
        },
      },
    },
    "/events-training/ops/notify-tutorial-published": {
      post: {
        tags: ["EventsTraining"],
        summary: "Notify owners — tutorial published",
        description:
          "Sales Portal ops. Activity feed for all station owners; Brevo email only when Firebase Auth emailVerified is true. Idempotent via training_video_publish_notices.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["videoId", "name"],
                properties: {
                  videoId: { type: "string" },
                  name: { type: "string" },
                  appId: { type: "string", default: "smartrefill" },
                  appPages: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Fan-out result (ownersNotified, emailsSent, alreadyNotified)." },
          401: { description: "Missing/invalid token." },
          403: { description: "Not Sales Portal admin/manager." },
        },
      },
    },
    "/events-training/ops/tutorial-publish-notice/{videoId}": {
      get: {
        tags: ["EventsTraining"],
        summary: "Get tutorial publish notice",
        description: "Idempotency notice doc status for a training video id.",
        parameters: [
          {
            name: "videoId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Notice document or not found." },
        },
      },
    },
    "/events-training/ops/notify-webinar-published": {
      post: {
        tags: ["EventsTraining"],
        summary: "Notify owners — webinar published",
        description:
          "Sales Portal ops. Activity-feed fan-out; idempotent via webinar_publish_notices.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["eventId", "name"],
                properties: {
                  eventId: { type: "string" },
                  name: { type: "string" },
                  appId: { type: "string", default: "smartrefill" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Fan-out result." },
          401: { description: "Missing/invalid token." },
          403: { description: "Not Sales Portal admin/manager." },
        },
      },
    },
    "/subscriptions/{businessId}/status": {
      get: {
        "tags": ["Subscriptions"],
        "summary": "Subscription Status",
        "x-frontend-read-model": "api-only",
        "parameters": [{ $ref: "#/components/parameters/businessId" }],
        "responses": {
          200: { description: "Current plan and entitlements." },
        },
      },
    },
    "/business/{businessId}/deliveries": {
      get: {
        "tags": ["Deliveries"],
        "summary": "List Delivery Routes",
        "x-frontend-read-model": "hybrid-gated",
        "parameters": [{ $ref: "#/components/parameters/businessId" }],
        "responses": {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Delivery" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Deliveries"],
        summary: "Provision Delivery Route Sheet",
        parameters: [{ $ref: "#/components/parameters/businessId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["riderId", "transactionIds"],
                properties: {
                  riderId: { type: "string" },
                  transactionIds: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Delivery" },
              },
            },
          },
        },
      },
    },
    "/business/{businessId}/riders": {
      get: {
        "tags": ["Riders"],
        "summary": "List Business Riders",
        "x-frontend-read-model": "hybrid-gated",
        "parameters": [{ $ref: "#/components/parameters/businessId" }],
        "responses": {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Rider" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Riders"],
        summary: "Create Rider Profile",
        parameters: [{ $ref: "#/components/parameters/businessId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "phone"],
                properties: {
                  name: { type: "string" },
                  phone: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Rider" },
              },
            },
          },
        },
      },
    },
    "/business/{businessId}/riders/{id}": {
      get: {
        "tags": ["Riders"],
        "summary": "Get Rider Profile",
        "x-frontend-read-model": "hybrid-gated",
        "parameters": [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/riderId" },
        ],
        "responses": {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { $ref: "#/components/schemas/Rider" },
                  },
                },
              },
            },
          },
        },
      },
      patch: {
        tags: ["Riders"],
        summary: "Update Rider Profile",
        parameters: [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/riderId" },
        ],
        responses: {
          200: { description: "Rider updated." },
        },
      },
    },
    "/business/{businessId}/riders/{id}/location": {
      post: {
        tags: ["Riders"],
        summary: "Update Rider Live GPS",
        description:
          "Persists `lastLocation` on `businesses/{businessId}/riders/{id}` for My Area, " +
          "customer track order, and shared route `/c`. " +
          "Caller must be the linked rider, owner, or admin.",
        parameters: [
          { $ref: "#/components/parameters/businessId" },
          { $ref: "#/components/parameters/riderId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["latitude", "longitude"],
                properties: {
                  latitude: { type: "number", example: 14.4081 },
                  longitude: { type: "number", example: 121.0415 },
                  accuracy: { type: "number" },
                  heading: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Location saved.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        lastLocation: { $ref: "#/components/schemas/RiderLastLocation" },
                      },
                    },
                  },
                },
              },
            },
          },
          403: { description: "Not the assigned rider or workspace admin." },
        },
      },
    },
    "/business/{businessId}/deliveries/share": {
      post: {
        tags: ["Deliveries"],
        summary: "Share Public Route Tracker",
        description:
          "Creates a `deliveryTrackers` document and returns its id for `/c?id=…`. " +
          "Include `riderId` in the body for live rider GPS on the public map.",
        parameters: [{ $ref: "#/components/parameters/businessId" }],
        responses: {
          201: {
            description: "Shared route id.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
    "/public/webhooks/meta/community": {
      get: {
        tags: ["Community", "Public"],
        summary: "Meta community Page webhook verify (CP-01)",
        description:
          "Meta subscription handshake. Echoes `hub.challenge` when `hub.verify_token` matches " +
          "`META_COMMUNITY_VERIFY_TOKEN`.",
        security: [],
        parameters: [
          { name: "hub.mode", in: "query", schema: { type: "string" } },
          { name: "hub.verify_token", in: "query", schema: { type: "string" } },
          { name: "hub.challenge", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: { description: "Challenge echoed as plain text." },
          403: { description: "Invalid verify token." },
          503: { description: "Webhook not configured." },
        },
      },
      post: {
        tags: ["Community", "Public"],
        summary: "Meta community Page webhook receive (CP-01 / CP-27)",
        description:
          "Receives Messenger `messages` and `messaging_postbacks`. Acknowledges immediately; " +
          "processes async. **CP-27:** requires valid `X-Hub-Signature-256` HMAC in production " +
          "(`META_COMMUNITY_APP_SECRET`).",
        security: [],
        parameters: [
          {
            name: "X-Hub-Signature-256",
            in: "header",
            required: false,
            schema: { type: "string" },
            description: "sha256= HMAC of raw JSON body",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  object: { type: "string", example: "page" },
                  entry: { type: "array", items: { type: "object" } },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "EVENT_RECEIVED" },
          403: { description: "Invalid or missing signature." },
          503: { description: "App secret not configured in production." },
        },
      },
    },
    "/public/portal/business-profile": {
      get: {
        tags: ["Public"],
        summary: "Station profile (Order & Counter Portal)",
        description:
          "Public business profile for customer-facing order and counter portals. " +
          "Query `b` = businessId; optional `page` and `pageSize` for feedback pagination (default 5). " +
          "Returns name, phone, address, map coordinates, average rating, and paginated feedback with masked customer names.",
        security: [],
        parameters: [
          {
            name: "b",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "businessId",
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 20, default: 5 },
          },
        ],
        responses: {
          200: {
            description: "Station profile payload.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        businessName: { type: "string" },
                        businessLogo: { type: "string", nullable: true },
                        phone: { type: "string", nullable: true },
                        address: { type: "string", nullable: true },
                        location: {
                          type: "object",
                          nullable: true,
                          properties: {
                            latitude: { type: "number" },
                            longitude: { type: "number" },
                          },
                        },
                        ratings: {
                          type: "object",
                          properties: {
                            average: { type: "number" },
                            count: { type: "integer" },
                          },
                        },
                        feedback: {
                          type: "object",
                          properties: {
                            items: { type: "array", items: { type: "object" } },
                            page: { type: "integer" },
                            pageSize: { type: "integer" },
                            total: { type: "integer" },
                            totalPages: { type: "integer" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: "Missing businessId." },
          404: { description: "Station not found." },
          500: { description: "Server error." },
        },
      },
    },
    "/public/portal/track/search": {
      get: {
        tags: ["Public"],
        summary: "Search Track Orders (Customer Portal)",
        description:
          "Lookup open orders when the customer does not know their reference ID. " +
          "Query `b` = businessId; provide any one of `name`, `email`, `company`, `phone` " +
          "(each min 2 chars, OR logic). Includes pending `raw_submissions` and open transactions.",
        security: [],
        parameters: [
          {
            name: "b",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "businessId",
          },
          {
            name: "name",
            in: "query",
            schema: { type: "string", minLength: 2 },
            description: "Customer name (optional; OR with other fields)",
          },
          {
            name: "email",
            in: "query",
            schema: { type: "string", minLength: 2 },
            description: "Email (optional; OR with other fields)",
          },
          {
            name: "company",
            in: "query",
            schema: { type: "string", minLength: 2 },
            description: "Company name (optional; OR with other fields)",
          },
          {
            name: "phone",
            in: "query",
            schema: { type: "string", minLength: 2 },
            description: "Phone (optional; OR with other fields)",
          },
          {
            name: "q",
            in: "query",
            schema: { type: "string", minLength: 2 },
            description: "Legacy single-string search (optional if name/email/company/phone set)",
          },
          {
            name: "c",
            in: "query",
            schema: { type: "string" },
            description: "Portal customerId (with `t`) to include logged-in customer orders",
          },
          {
            name: "t",
            in: "query",
            schema: { type: "string" },
            description: "Portal token (with `c`)",
          },
        ],
        responses: {
          200: {
            description: "Matching open orders.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/PortalTrackSearchRow" },
                    },
                  },
                },
              },
            },
          },
          400: { description: "Missing businessId or query too short." },
          500: { description: "Server error." },
        },
      },
    },
    "/public/portal/track/{referenceId}": {
      get: {
        tags: ["Public"],
        summary: "Track Order (Customer Portal)",
        description:
          "Public order status for `/order` track tab. Query `b` = businessId. " +
          "Returns rider location (in-transit), destination, ETAs fields, " +
          "and other-active-stop count.",
        security: [],
        parameters: [
          {
            name: "referenceId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "b",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "businessId",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { $ref: "#/components/schemas/PortalTrackOrder" },
                  },
                },
              },
            },
          },
          404: { description: "Order not found." },
        },
      },
    },
    "/public/shared-route/{id}": {
      get: {
        tags: ["Public"],
        summary: "Get Shared Route Tracker",
        description:
          "Public manifest for `/c?id=…`. Merges live rider GPS and per-stop " +
          "`arrivedAt`/`deliveredAt` from transactions.",
        security: [],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "deliveryTrackers document id",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "object" },
                  },
                },
              },
            },
          },
          404: { description: "Shared route not found." },
        },
      },
    },
  },
};
