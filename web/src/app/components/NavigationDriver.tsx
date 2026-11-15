import { useEffect, useRef } from "react";
import { navigate } from "../history";
import { useAppStore } from "../store";

export function NavigationDriver() {
  const request = useAppStore((s) => s.navigationRequest);
  const handledRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!request || handledRequestIdRef.current === request.id) {
      return;
    }
    handledRequestIdRef.current = request.id;
    navigate(request.to, request.replace);
  }, [request]);

  return null;
}
