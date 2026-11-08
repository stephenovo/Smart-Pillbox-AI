import { legacyUnavailable } from "../../../src/lib/pilot/api";
import { NextResponse } from "next/server";

import {
  getUserProfile,
  setUserProfile,
  validateUserProfileUpdate,
} from "../../../src/lib/userProfileStore";
import type { UserProfileApiResponse } from "../../../src/types/profile";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...responseHeaders,
      ...init?.headers,
    },
  });
}

export async function GET() {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  const response: UserProfileApiResponse = { profile: getUserProfile() };
  return jsonResponse(response);
}

export async function PUT(request: Request) {
  const blockedDemo = legacyUnavailable();
  if (blockedDemo) return blockedDemo;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const result = validateUserProfileUpdate(body);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, { status: 400 });
  }

  const response: UserProfileApiResponse = {
    profile: setUserProfile(result.profile),
  };
  return jsonResponse(response);
}
