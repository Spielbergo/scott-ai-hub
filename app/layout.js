import "./globals.css";

export const metadata = {
  title: "Scott AI Hub",
  description: "Scott AI Operations Hub — Market Trend Agent Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
