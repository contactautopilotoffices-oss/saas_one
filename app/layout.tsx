import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpsCentral - Facility Management System",
  description: "The all-in-one platform for modern facilities. Manage everything from visitor access and desk booking to HVAC monitoring in one place.",
  keywords: ["facility management", "workplace operations", "desk booking", "asset tracking", "SaaS"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-white text-slate-900 overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
