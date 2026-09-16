import { NextResponse } from "next/server";
import { HealthResponse } from "@/src/health";

export async function GET() {
  const body: HealthResponse = {
    status: "ok",
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body);
}