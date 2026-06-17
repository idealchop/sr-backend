import * as fs from "fs";
import * as path from "path";
import { openApiSpec } from "./openapi";

interface PostmanItem {
  name: string;
  request: {
    method: string;
    header: Array<{ key: string; value: string; type: string }>;
    url: {
      raw: string;
      host: string[];
      path: string[];
      variable: Array<{ key: string; value: string; description?: string }>;
    };
    body?: {
      mode: string;
      raw: string;
      options: {
        raw: {
          language: string;
        };
      };
    };
  };
}

interface PostmanFolder {
  name: string;
  item: PostmanItem[];
}

const generatePostmanCollection = () => {
  console.log("🚀 Starting Postman Collection generation...");

  const collection = {
    info: {
      _postman_id: `smartrefill-v3-api-${Date.now()}`,
      name: "SmartRefill V3 API Gateway",
      description:
        "Auto-generated from OpenAPI 3.0 (npm run docs:generate). " +
        "GET requests include x-frontend-read-model (firestore-primary, api-fallback, etc.). " +
        "See smartrefill/frontend/docs/hybrid-read-model.md.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [] as PostmanFolder[],
  };

  // Group by tags
  const tagsMap: Record<string, PostmanItem[]> = {};

  // Initialize tags
  (openApiSpec.tags || []).forEach((tag: any) => {
    tagsMap[tag.name] = [];
  });

  const fallbackTag = "Other";
  tagsMap[fallbackTag] = [];

  // Parse OpenAPI paths
  Object.entries(openApiSpec.paths || {}).forEach(([rawPath, methodsObj]: [string, any]) => {
    Object.entries(methodsObj).forEach(([method, endpoint]: [string, any]) => {
      const tag = (endpoint.tags && endpoint.tags[0]) || fallbackTag;
      if (!tagsMap[tag]) {
        tagsMap[tag] = [];
      }

      // Convert path params from {param} to :param for Postman
      let postmanPath = rawPath;
      const pathParamsMatches = rawPath.match(/\{[^}]+\}/g) || [];
      const variable: any[] = [];

      pathParamsMatches.forEach((match) => {
        const paramName = match.slice(1, -1);
        postmanPath = postmanPath.replace(match, `:${paramName}`);
        variable.push({
          key: paramName,
          value: `{{${paramName}}}`,
          description: `Path variable: ${paramName}`,
        });
      });

      // Headers
      const header = [
        {
          key: "Authorization",
          value: "Bearer {{firebase_token}}",
          type: "text",
        },
        {
          key: "Content-Type",
          value: "application/json",
          type: "text",
        },
      ];

      // Body (if applicable)
      let body: any = undefined;
      if (endpoint.requestBody?.content?.["application/json"]?.schema) {
        const schema = endpoint.requestBody.content["application/json"].schema;
        const mockBodyObj: Record<string, any> = {};

        if (schema.properties) {
          Object.entries(schema.properties).forEach(([propName, propDetails]: [string, any]) => {
            if (propDetails.example !== undefined) {
              mockBodyObj[propName] = propDetails.example;
            } else if (propDetails.type === "string") {
              mockBodyObj[propName] = propDetails.enum ? propDetails.enum[0] : `sample_${propName}`;
            } else if (propDetails.type === "number" || propDetails.type === "integer") {
              mockBodyObj[propName] = 0;
            } else if (propDetails.type === "boolean") {
              mockBodyObj[propName] = false;
            } else if (propDetails.type === "array") {
              mockBodyObj[propName] = [];
            } else {
              mockBodyObj[propName] = {};
            }
          });
        }

        body = {
          mode: "raw",
          raw: JSON.stringify(mockBodyObj, null, 2),
          options: {
            raw: {
              language: "json",
            },
          },
        };
      }

      const readModel = endpoint["x-frontend-read-model"] as string | undefined;
      const descriptionParts = [
        endpoint.description,
        readModel && `Read model: ${readModel}`,
      ].filter(Boolean);
      const itemDescription =
        descriptionParts.length > 0 ? descriptionParts.join("\n\n") : undefined;

      const item: PostmanItem & { request: PostmanItem["request"] & { description?: string } } = {
        name: endpoint.summary || `${method.toUpperCase()} ${rawPath}`,
        request: {
          method: method.toUpperCase(),
          header,
          url: {
            raw: `{{base_url}}${postmanPath}`,
            host: ["{{base_url}}"],
            path: postmanPath.split("/").filter((segment) => segment.length > 0),
            variable,
          },
          ...(body && { body }),
          ...(itemDescription && { description: itemDescription }),
        },
      };

      tagsMap[tag].push(item as PostmanItem);
    });
  });

  // Assemble the folders in order
  Object.entries(tagsMap).forEach(([folderName, items]) => {
    if (items.length > 0) {
      collection.item.push({
        name: folderName,
        item: items,
      });
    }
  });

  // Target paths for file writing
  const outputPathFE = path.resolve(
    __dirname,
    "../../../../frontend/docs/postman-collection.json",
  );
  const outputPathBEFolder = path.resolve(__dirname, "../../docs");
  const outputPathBE = path.resolve(outputPathBEFolder, "postman-collection.json");

  // Create BE docs folder if not exists
  if (!fs.existsSync(outputPathBEFolder)) {
    fs.mkdirSync(outputPathBEFolder, { recursive: true });
  }

  const collectionJSON = JSON.stringify(collection, null, 2);

  // Write to Backend docs/postman-collection.json
  fs.writeFileSync(outputPathBE, collectionJSON, "utf8");
  console.log(`✅ Postman Collection written to Backend: ${outputPathBE}`);

  // Write to Frontend docs/postman-collection.json if the directory exists
  const feDocsDir = path.dirname(outputPathFE);
  if (fs.existsSync(feDocsDir)) {
    fs.writeFileSync(outputPathFE, collectionJSON, "utf8");
    console.log(`✅ Postman Collection written to Frontend: ${outputPathFE}`);
  } else {
    console.log(`⚠️ Frontend docs directory not found at: ${feDocsDir}. Skipping Frontend write.`);
  }

  console.log("🎉 Postman Collection Generation complete!");
};

// Execute if run directly
if (require.main === module) {
  generatePostmanCollection();
}
