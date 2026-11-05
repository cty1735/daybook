/* 极简 hash 路由：#/overview、#/users、#/users/<id>、#/transactions、#/stats、#/audit、#/system */

import { useEffect, useState } from "react";

export interface Route {
  name: string;
  params: string[];
}

function parse(): Route {
  if (typeof location === "undefined") return { name: "overview", params: [] };
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return { name: "overview", params: [] };
  return { name: parts[0], params: parts.slice(1) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  const target = `#/${path.replace(/^\/+/, "")}`;
  if (location.hash !== target) location.hash = target;
}
