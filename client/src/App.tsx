import type { User } from "@auction/shared";
import { useCallback, useEffect, useState } from "react";
import { getSession, setName } from "./api";
import { Credits } from "./pages/Credits";
import { Landing } from "./pages/Landing";
import { RoomPage } from "./pages/RoomPage";
import { usePath } from "./router";

export function App() {
  const path = usePath();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    getSession().then(setUser, () => setUser(null));
  }, []);

  const onName = useCallback(async (name: string) => {
    const u = await setName(name);
    setUser(u);
    return u;
  }, []);

  if (user === undefined) return null;
  const room = path.match(/^\/r\/([A-Za-z0-9]{4,12})\/?$/);
  if (room) {
    // The session key changes when the name changes, which reconnects the socket with the new cookie.
    return <RoomPage roomId={room[1]!.toUpperCase()} sessionKey={user ? `${user.id}:${user.name}` : "anon"} onName={onName} />;
  }
  if (path === "/credits") return <Credits />;
  return <Landing user={user} onName={onName} />;
}
