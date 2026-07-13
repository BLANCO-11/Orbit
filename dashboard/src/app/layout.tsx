import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "./ThemeScript";
import ClientDashboard from "./ClientDashboard";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

export const metadata = {
  title: "Orbit - Personal Assistant Console",
  description:
    "Advanced Personal Assistant OS framework with access controls and headless browsing console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${plusJakartaSans.variable} min-h-full flex flex-col antialiased`}>
        <ClientDashboard />
      </body>
    </html>
  );
}
