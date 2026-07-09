import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata = {
  title: "AegisAgent - Personal Assistant Console",
  description: "Advanced Personal Assistant OS framework with access controls and headless browsing console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark h-full">
      <body className={`${outfit.className} min-h-full flex flex-col`}>
        {children}
      </body>
    </html>
  );
}
