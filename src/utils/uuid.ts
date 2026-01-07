/**
 * Generate a UUID v4 compatible string without requiring crypto.getRandomValues()
 * This works in React Native/Expo environments
 */
export const generateUUID = (): string => {
  // Generate random hex values
  const getRandomHex = (): string => {
    return Math.floor(Math.random() * 16).toString(16);
  };

  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where x is any hexadecimal digit and y is one of 8, 9, A, or B
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  
  return template.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
};

