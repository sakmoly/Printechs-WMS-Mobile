/**
 * Material Request Picking Flow Theme
 * Matches Cycle Count design patterns
 */

export const PickingTheme = {
  colors: {
    // Header colors
    headerBlue: "#1976D2", // Material Request Detail header
    headerPurple: "#8E24AA", // Scan Bin and Scan Items header
    headerOrange: "#FB8C00", // Scan Carton card background
    
    // Action buttons
    buttonGreen: "#43A047", // Resume/Start Picking button
    buttonBlue: "#1E88E5", // Scan button, item scan card
    buttonPurple: "#8E24AA", // Start Picking button
    
    // Text colors
    textPrimary: "#333333",
    textSecondary: "#666666",
    textWhite: "#FFFFFF",
    textLight: "#E1BEE7", // Purple header subtitle
    
    // Status colors
    statusPending: "#FF9800",
    statusPartial: "#2196F3",
    statusDone: "#4CAF50",
    
    // Background colors
    backgroundLight: "#F5F5F5",
    backgroundWhite: "#FFFFFF",
    backgroundCard: "#FFFFFF",
    
    // Border colors
    borderLight: "#E0E0E0",
    borderPurple: "#8E24AA",
    borderBlue: "#1E88E5",
  },
  
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  
  borderRadius: {
    small: 8,
    medium: 12,
    large: 16,
    xlarge: 20,
  },
  
  typography: {
    h1: {
      fontSize: 24,
      fontWeight: "bold" as const,
    },
    h2: {
      fontSize: 20,
      fontWeight: "600" as const,
    },
    h3: {
      fontSize: 18,
      fontWeight: "600" as const,
    },
    body: {
      fontSize: 16,
      fontWeight: "400" as const,
    },
    caption: {
      fontSize: 14,
      fontWeight: "400" as const,
    },
  },
  
  shadows: {
    card: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    button: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 4,
    },
  },
};
