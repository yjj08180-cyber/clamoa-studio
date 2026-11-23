import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "CLAMOA Studio | 클라모아 피드 스튜디오",
  description:
    "클라모아 팀의 리서치, 에디토리얼 기획, 피드 이미지 제작 워크스페이스.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
