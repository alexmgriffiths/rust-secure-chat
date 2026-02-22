import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import LoginPage from "./pages/LoginPage";
import ChatPage from "./pages/ChatPage";
import DeviceSetupPage from "./pages/DeviceSetupPage";
import { useAuth } from "./contexts/AuthContext";

function App() {
  const { isAuthenticated } = useAuth() as { isAuthenticated: boolean };

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/device-setup"
        element={isAuthenticated ? <DeviceSetupPage /> : <Navigate to="/login" />}
      />
      <Route
        path="/chat"
        element={isAuthenticated ? <ChatPage /> : <Navigate to="/login" />}
      />
      <Route path="*" element={<Navigate to={isAuthenticated ? "/chat" : "/login"} />} />
    </Routes>
  );
}

export default App;
