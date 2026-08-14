import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Optimistic auth gate for the admin console (Next 16 Proxy, formerly Middleware).
 * This app serves only the admin audience, on its own origin: every page needs an
 * `admin_session`; unauthenticated requests bounce to `/admin/login`. Real
 * validation happens in the backend on every proxied call — this only checks for
 * the cookie's presence.
 */

const ADMIN_SESSION = "admin_session";
const ADMIN_LOGIN = "/admin/login";
const ADMIN_HOME = "/analytics";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authed = Boolean(request.cookies.get(ADMIN_SESSION)?.value);

  const redirect = (path: string, query = "") => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = query;
    return NextResponse.redirect(url);
  };

  // Login page: send an already-signed-in admin to their home.
  if (pathname === ADMIN_LOGIN) return authed ? redirect(ADMIN_HOME) : NextResponse.next();

  // Root: home if signed in, else login.
  if (pathname === "/") return redirect(authed ? ADMIN_HOME : ADMIN_LOGIN);

  if (!authed) return redirect(ADMIN_LOGIN, `?next=${encodeURIComponent(pathname + search)}`);

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
