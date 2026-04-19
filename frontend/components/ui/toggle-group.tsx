"use client"

import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleGroupItemVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all outline-none focus-visible:z-10 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=off]:bg-transparent hover:bg-muted/60",
  {
    variants: {
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-9 px-4",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("inline-flex items-center rounded-md border border-input bg-background", className)}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
