// Every client payload is parsed here before it reaches a Room.
import { TEAM_IDS } from "@auction/shared";
import { z } from "zod";

const teamId = z.enum(TEAM_IDS);
const requestId = z.string().min(1).max(64);

export const requestSchema = z.discriminatedUnion("type", [
  z.object({ requestId, type: z.literal("join") }),
  z.object({ requestId, type: z.literal("leave") }),
  z.object({ requestId, type: z.literal("claim"), teamId }),
  z.object({ requestId, type: z.literal("release"), teamId }),
  z.object({
    requestId,
    type: z.literal("settings"),
    settings: z.object({
      preset: z.enum(["quick", "capped", "full"]).optional(),
      start: z.enum(["retained", "fresh"]).optional(),
    }).strict(),
  }),
  z.object({ requestId, type: z.literal("start") }),
  z.object({ requestId, type: z.literal("bid"), teamId, amount: z.number().int().positive().max(1_000_000) }),
  z.object({ requestId, type: z.literal("skip"), teamId }),
  z.object({ requestId, type: z.literal("pause") }),
  z.object({ requestId, type: z.literal("reset") }),
]);

export type WireRequest = z.infer<typeof requestSchema>;

export const nameSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(24, "Keep it to 24 characters"),
});

export const roomIdSchema = z.string().regex(/^[A-Za-z0-9]{4,12}$/);
