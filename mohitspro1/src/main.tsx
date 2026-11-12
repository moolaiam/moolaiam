import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MohitsPro1 from "./components/MohitsPro1.tsx";
import "./styles/mohits.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MohitsPro1 />
  </StrictMode>
);
