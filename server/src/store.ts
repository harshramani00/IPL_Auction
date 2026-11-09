// Where rooms live. v1 keeps them in memory (lost on restart); a Redis-backed
// store can implement the same interface for persistence and horizontal scale.
import { randomInt } from "node:crypto";
import type { Room } from "./room.js";

export interface RoomStore {
  get(id: string): Room | undefined;
  add(room: Room): void;
  delete(id: string): void;
  ids(): string[];
  /** A fresh, unused room code. */
  newId(): string;
}

// No 0/O/1/I/L so codes are easy to read out loud.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>();

  get(id: string) {
    return this.rooms.get(id.toUpperCase());
  }

  add(room: Room) {
    this.rooms.set(room.id, room);
  }

  delete(id: string) {
    this.rooms.get(id)?.dispose();
    this.rooms.delete(id);
  }

  ids() {
    return [...this.rooms.keys()];
  }

  newId() {
    for (;;) {
      const id = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
      if (!this.rooms.has(id)) return id;
    }
  }
}
