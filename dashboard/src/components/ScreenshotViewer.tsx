// @ts-nocheck
"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function ScreenshotViewer({ screenshotFile }) {
  if (!screenshotFile) return null;

  return (
    <Card className="flex flex-col">
      <CardHeader className="border-b border-border py-2.5">
        <CardTitle className="text-xs font-semibold text-muted-foreground">
          Browser Preview (Lightpanda)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-center overflow-hidden bg-black/20 p-3">
        <img src={screenshotFile} alt="Browser Screenshot" className="max-h-full max-w-full object-contain" />
      </CardContent>
    </Card>
  );
}
