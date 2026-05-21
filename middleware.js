/**
 * middleware.js
 * Redirect unauthenticated users away from /dashboard.
 * Checks for the HttpOnly __session cookie set by /api/auth/session.
 */
import { NextResponse } from 'next/server';

export function middleware(request) {
  const session = request.cookies.get('__session');
  if (!session?.value) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
