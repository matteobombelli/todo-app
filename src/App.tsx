import { Outlet } from "react-router";
import { AuthProvider } from "./auth/AuthProvider";
import { UpdateToast } from "./pwa";

export default function App() {
  return (
    <AuthProvider>
      <Outlet />
      <UpdateToast />
    </AuthProvider>
  );
}
