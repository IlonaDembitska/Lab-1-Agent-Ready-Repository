import { describe, expect, it } from "vitest";
import { HealthResponse } from "../src/health";

describe("HealthResponse", () => {
  it("accepts a valid health response", () => {
    const result = HealthResponse.safeParse({
      status: "ok",
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid status", () => {
    const result = HealthResponse.safeParse({
      status: "error",
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid timestamp", () => {
    const result = HealthResponse.safeParse({
      status: "ok",
      timestamp: "not-a-date",
    });

    expect(result.success).toBe(false);
  });
});