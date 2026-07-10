import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "./ThemeScript";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

export const metadata = {
  title: "AegisAgent - Personal Assistant Console",
  description:
    "Advanced Personal Assistant OS framework with access controls and headless browsing console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark h-full" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${inter.variable} min-h-full flex flex-col antialiased`}>
        {children}
      </body>
    </html>
  );
}
