import type { Metadata } from "next";
import "@/styles.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "PAN Budget Sentinel",
  description: "Análise automatizada de PANs vs. orçamento aprovado",
  openGraph: {
    title: "PAN Budget Sentinel",
    description: "Análise automatizada de PANs vs. orçamento aprovado",
    type: "website",
  },
  twitter: {
    card: "summary",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
