// @ts-nocheck
import * as React from "react"
import { cn } from "@/lib/utils"

function Kbd({ className, ...props }) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-b-2 border-border bg-muted px-1.5 font-mono text-[0.65rem] font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export { Kbd }
