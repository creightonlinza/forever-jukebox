import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store";

export function NavigationDriver() {
  const navigate = useNavigate();
  const request = useAppStore((s) => s.navigationRequest);
  const handledRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!request || handledRequestIdRef.current === request.id) {
      return;
    }
    handledRequestIdRef.current = request.id;
    navigate(request.to, { replace: request.replace });
  }, [navigate, request]);

  return null;
}
