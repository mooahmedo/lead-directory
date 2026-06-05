import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "نظام مبادرة الأمراض المزمنة — محافظة سوهاج",
  description: "نظام تسجيل زيارات مرضى مبادرة الأمراض المزمنة للوحدات الصحية بمحافظة سوهاج",
  keywords: "مبادرة الأمراض المزمنة, سوهاج, صحة, تسجيل مرضى",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&family=Tajawal:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased min-h-screen bg-background" style={{ fontFamily: "'Cairo', 'Tajawal', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
