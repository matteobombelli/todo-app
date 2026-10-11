import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { PALETTE, STD_COLOR } from "../shared/palette";
import App from "./App";
import { RequireAuth } from "./auth/RequireAuth";
import CalendarPage from "./calendar/CalendarPage";
import LoginPage from "./routes/LoginPage";
import RegisterPage from "./routes/RegisterPage";
import Shell from "./Shell";
import ListPage from "./todo/ListPage";
import ListsPage from "./todo/ListsPage";
import "./styles.css";

// shared/palette.ts owns the colour values; expose each as a scheme-aware CSS variable. A media
// query rather than light-dark(), which Safari only has from 17.5: before, every colour was blank.
const paletteStyle = document.createElement("style");
const palette = (scheme: "light" | "dark") =>
  Object.entries(PALETTE)
    .map(([key, colors]) => `--palette-${key}:${colors[scheme]};`)
    .join("");
paletteStyle.textContent = `:root{--std:${STD_COLOR};${palette("light")}}@media (prefers-color-scheme: dark){:root{${palette("dark")}}}`;
document.head.append(paletteStyle);

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/calendar" replace /> },
      { path: "login", element: <LoginPage /> },
      { path: "signup", element: <RegisterPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <Shell />,
            children: [
              { path: "todo", element: <ListsPage /> },
              { path: "todo/:listId", element: <ListPage /> },
              { path: "calendar", element: <CalendarPage /> },
            ],
          },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
