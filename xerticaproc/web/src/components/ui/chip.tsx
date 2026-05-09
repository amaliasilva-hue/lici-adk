import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "cyan" | "green" | "amber" | "red" | "mute";

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const toneMap: Record<Tone, string> = {
  cyan: "chip-cyan",
  green: "chip-green",
  amber: "chip-amber",
  red: "chip-red",
  mute: "",
};

export function Chip({ className, tone = "mute", ...rest }: ChipProps) {
  return <span className={cn("chip", toneMap[tone], className)} {...rest} />;
}
