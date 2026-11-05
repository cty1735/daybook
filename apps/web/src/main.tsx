import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { App } from "./App";
import { useStore } from "./store/store";

// 启动时校验会话并拉取账本；App 在加载完成前显示引导屏
void useStore.getState().init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);