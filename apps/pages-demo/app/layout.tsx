import type { Metadata } from "next";
import "../../portal/app/globals.css";

export const metadata: Metadata = {
  title: "PyTorch Philippines — Demo",
  description: "Explore the PyTorch Philippines community platform with fictional example accounts and sample data.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className="dark"><body>
    {children}
    <aside className="fixed bottom-0 inset-x-0 z-50 border-t border-orange-500/30 bg-[#17100b]/95 px-4 py-2 text-center text-xs text-orange-100 backdrop-blur" aria-label="Demo notice">
      Demo only · Fictional accounts and sample data · No real signup, payments, or submissions
    </aside>
  </body></html>;
}
