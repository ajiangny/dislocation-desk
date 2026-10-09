import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { applyTheme, initialTheme } from "./lib/theme";
import "./styles.css";

applyTheme(initialTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
