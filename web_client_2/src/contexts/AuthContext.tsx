import axios from "axios";
import { createContext, useContext, useEffect, useState } from "react";
import { useIndexedDB } from "../hooks/useIndexDb";

// TODO: Fix any
const AuthContext: any = createContext(null);
export const useAuth = () => useContext(AuthContext);

// TODO: Fix any
export const AuthProvider = ({ children }: any) => {
  const [userId, setUserId] = useState(localStorage.getItem("userId"));
  const [token, setToken] = useState(localStorage.getItem("authToken"));

  const { putValue, getAllValues, isDBConnecting } = useIndexedDB("keys-db", [
    "keys-table",
    "sessions-table",
    "messages-table",
    "contacts-table",
  ]);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      localStorage.setItem("authToken", token);
    } else {
      delete axios.defaults.headers.common["Authorization"];
      localStorage.removeItem("authToken");
    }

    if (userId) {
      localStorage.setItem("userId", userId);
    } else {
      localStorage.removeItem("userId");
    }
  }, [token, userId]);

  // TODO: Fix any
  const login = async (credentials: any) => {
    try {
      const response = await axios.post(
        "http://localhost:3000/login",
        credentials,
      );
      const { token, id } = response.data;
      setToken(token);
      setUserId(id);
      return token;
    } catch (e) {
      console.error("login failed", e);
      throw new Error("Login failed");
    }
  };

  const logout = () => {
    setToken(null);
    setUserId(null);
  };

  const checkHasKeys = async (): Promise<boolean> => {
    if (isDBConnecting) return false;
    const keys = await getAllValues("keys-table");
    console.log(keys);
    return keys.length > 0;
  };

  const putKeys = async (keys: object): Promise<void> => {
    await putValue("keys-table", keys);
  };

  const value = {
    token,
    userId,
    isAuthenticated: !!token,
    isDBConnecting,
    login,
    logout,
    checkHasKeys,
    putKeys,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
