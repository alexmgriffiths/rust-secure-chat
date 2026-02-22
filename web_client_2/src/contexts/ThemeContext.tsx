import { createContext, useContext, useState } from "react";

type Theme = "dark" | "light";
type ThemeCtx = { theme: Theme; toggle: () => void };

const ThemeContext = createContext<ThemeCtx>({ theme: "dark", toggle: () => {} });

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    // Set attribute synchronously to avoid flash of wrong theme
    const stored = (localStorage.getItem("theme") as Theme) ?? "dark";
    document.documentElement.setAttribute("data-theme", stored);
    return stored;
  });

  const toggle = () => {
    const root = document.documentElement;
    root.classList.add("theme-transitioning");
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
      return next;
    });
    setTimeout(() => root.classList.remove("theme-transitioning"), 300);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
};
