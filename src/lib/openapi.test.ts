import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogOpenApi, inputSchemaForOperation, mergeOpenApiSpecs, requestOpenApi, rewriteInternalSchemaRefs } from "./openapi";
import type { SourceConfig } from "../types";

const source: SourceConfig = {
  id: "source-id",
  ownerId: "user-id",
  slug: "demo-api",
  type: "openapi",
  name: "Demo API",
  baseUrl: "https://api.example.com/v1",
  specUrl: "https://api.example.com/openapi.json",
  authType: "none",
  authHeaderName: null,
  encryptedSecret: null,
  metadata: {},
  enabled: true
};

describe("catalogOpenApi", () => {
  it("catalogs only executable HTTP methods", () => {
    const entries = catalogOpenApi(source, {
      paths: {
        "/items": {
          get: { operationId: "listItems" },
          post: { operationId: "createItem" },
          head: { operationId: "headItems" },
          options: { operationId: "optionsItems" },
          trace: { operationId: "traceItems" }
        }
      }
    });

    expect(entries.map((entry) => entry.operation)).toEqual(["listItems", "createItem"]);
  });
});

describe("inputSchemaForOperation", () => {
  it("describes path params, query params, and JSON body request options", () => {
    expect(
      inputSchemaForOperation({
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "x-preview", in: "header", schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"]
              }
            }
          }
        }
      })
    ).toEqual({
      type: "object",
      properties: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        query: {
          type: "object",
          properties: { limit: { type: "integer" } }
        },
        headers: {
          type: "object",
          properties: { "x-preview": { type: "string" } }
        },
        body: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"]
        }
      },
      required: ["params", "body"]
    });
  });
});

describe("OpenAPI ref rewriting", () => {
  it("rewrites internal schema refs recursively", () => {
    expect(
      rewriteInternalSchemaRefs(
        {
          schema: { $ref: "#/components/schemas/User" },
          items: [{ $ref: "#/components/schemas/Role" }],
          external: { $ref: "https://example.com/schema.json" }
        },
        "workos-api"
      )
    ).toEqual({
      schema: { $ref: "#/components/schemas/workos-api_User" },
      items: [{ $ref: "#/components/schemas/workos-api_Role" }],
      external: { $ref: "https://example.com/schema.json" }
    });
  });

  it("rewrites path and component refs in combined specs", () => {
    const combined = mergeOpenApiSpecs([
      {
        source,
        spec: {
          paths: {
            "/users": {
              get: {
                responses: {
                  "200": {
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/User" }
                      }
                    }
                  }
                }
              }
            }
          },
          components: {
            schemas: {
              User: {
                type: "object",
                properties: {
                  role: { $ref: "#/components/schemas/Role" }
                }
              },
              Role: { type: "string" }
            }
          }
        }
      }
    ]);

    expect(combined).toMatchObject({
      paths: {
        "/demo-api/users": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/demo-api_User" }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          "demo-api_User": {
            properties: {
              role: { $ref: "#/components/schemas/demo-api_Role" }
            }
          }
        }
      }
    });
  });
});

describe("requestOpenApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns structured status metadata for non-2xx JSON responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), {
        status: 422,
        statusText: "Unprocessable Content",
        headers: { "content-type": "application/json", "x-request-id": "req_123" }
      })
    );

    await expect(
      requestOpenApi(source, {
        method: "GET",
        path: "/users/{id}",
        params: { id: "user 123" },
        query: { expand: "roles" },
        headers: { "x-preview": "true" }
      })
    ).resolves.toEqual({
      ok: false,
      status: 422,
      statusText: "Unprocessable Content",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_123"
      },
      data: { error: "nope" }
    });

    expect(fetchMock).toHaveBeenCalledWith(new URL("https://api.example.com/v1/users/user%20123?expand=roles"), {
      method: "GET",
      headers: new Headers({ "x-preview": "true" }),
      body: undefined
    });
  });
});
