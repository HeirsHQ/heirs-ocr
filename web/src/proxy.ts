import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic, role-aware auth gate (Next 16 Proxy, formerly Middleware). It only
 * checks for the presence of the right session cookie — real validation happens in
 * the backend on every proxied call. One deployment serves two audiences:
 *
 *   - **Tenant area** (`/ocr`, `/keys`, `/team`) → needs a `tenant_session`; login at `/login`.
 *   - **Admin area** (everything else) → needs an `admin_session`; login at `/admin/login`.
 *
 * Each area bounces the unauthenticated to its own login, and a signed-in user off
 * that login to their home.
 */

const TENANT_SESSION = "tenant_session";
const ADMIN_SESSION = "admin_session";

const TENANT_LOGIN = "/login";
const ADMIN_LOGIN = "/admin/login";
const TENANT_HOME = "/ocr";
const ADMIN_HOME = "/analytics";

/** Route prefixes that make up the tenant portal; everything else is the admin area. */
const TENANT_AREA = ["/ocr", "/keys", "/team"];

const inArea = (pathname: string, prefixes: string[]): boolean =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const tenantAuthed = Boolean(request.cookies.get(TENANT_SESSION)?.value);
  const adminAuthed = Boolean(request.cookies.get(ADMIN_SESSION)?.value);

  const redirect = (path: string, query = "") => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = query;
    return NextResponse.redirect(url);
  };

  // Login pages: send an already-signed-in user to their home.
  if (pathname === TENANT_LOGIN) return tenantAuthed ? redirect(TENANT_HOME) : NextResponse.next();
  if (pathname === ADMIN_LOGIN) return adminAuthed ? redirect(ADMIN_HOME) : NextResponse.next();

  // Root: route to the right place based on whichever session exists.
  if (pathname === "/") {
    if (tenantAuthed) return redirect(TENANT_HOME);
    if (adminAuthed) return redirect(ADMIN_HOME);
    return redirect(TENANT_LOGIN);
  }

  const next = `?next=${encodeURIComponent(pathname + search)}`;
  if (inArea(pathname, TENANT_AREA)) {
    if (!tenantAuthed) return redirect(TENANT_LOGIN, next);
  } else if (!adminAuthed) {
    return redirect(ADMIN_LOGIN, next);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals, the API proxy routes (they enforce their
  // own auth), and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
