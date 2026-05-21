"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "./AuthProvider";

export default function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen]   = useState(false);
  const ref               = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!user) return null;

  const initials = (user.displayName || user.email || "?")
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="User menu"
        className="flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={user.displayName || "User"}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full ring-2 ring-gray-700 hover:ring-gray-500 transition-all"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-emerald-700 ring-2 ring-gray-700 hover:ring-gray-500 transition-all flex items-center justify-center text-xs font-bold text-white">
            {initials}
          </div>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-800 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
          {/* User info */}
          <div className="px-4 py-3 border-b border-gray-800">
            {user.displayName && (
              <p className="text-sm font-semibold text-white truncate">{user.displayName}</p>
            )}
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>

          {/* Sign out */}
          <button
            onClick={() => { setOpen(false); signOut(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
