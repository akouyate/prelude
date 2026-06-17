import { tokens } from "../tokens";

const preset = {
  theme: {
    extend: {
      colors: tokens.colors,
      borderRadius: tokens.radius,
      boxShadow: tokens.shadows,
      fontFamily: {
        sans: [tokens.fontFamily.sans]
      },
      screens: tokens.breakpoints
    }
  }
};

export default preset;
