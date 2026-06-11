import type { Metadata } from "next";
import "@/styles.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Ajudante PAN",
  description: ":)",
  openGraph: {
    title: "Ajudante PAN",
    description: ":)",
    type: "website",
  },
  twitter: {
    card: "summary",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
