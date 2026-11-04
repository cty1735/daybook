import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { App } from "./App";
import { useStore } from "./store/store";

// 先把 IndexedDB 里的数据装载进内存 store；App 在 hydrated 之前显示引导屏
void useStore.getState().init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);