import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16+ Proxy (replaces middleware.ts in this version).
 *
 * Critical responsibilities:
 *  1. Refreshes the Supabase session token stored in cookies so it never
 *     goes stale between requests (prevents random logouts).
 *  2. Returns the updated response with refreshed cookies propagated.
 *
 * IMPORTANT: Do NOT block API routes here.
 *  - /api/auth/lookup-username must be accessible WITHOUT authentication
 *    (it is the first step of the login flow).
 *  - Individual API routes handle their own authorization checks.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Skip if env vars are missing (e.g. build time)
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write updated cookies back onto the request (for this request)
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Rebuild the response with the refreshed cookies propagated
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do NOT add any code between createServerClient and getClaims().
  // getClaims() refreshes the access token if it is about to expire and writes
  // the new token back into cookies via the setAll() hook above.
  await supabase.auth.getClaims();

  // IMPORTANT: Return supabaseResponse (not a new NextResponse.next()) so the
  // refreshed cookies are included in the response sent to the browser.
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static  (static assets)
     * - _next/image   (image optimization)
     * - favicon.ico
     * - public image files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
